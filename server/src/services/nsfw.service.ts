import { Injectable } from '@nestjs/common';
import type { JobOf } from 'src/types.js';
import { OnJob } from 'src/decorators.js';
import { SystemConfig } from 'src/dtos/config.dto.js';
import { AssetType, AssetVisibility, JobName, JobStatus, QueueName } from 'src/enum.js';
import {
  NSFW_CLIP_MODEL,
  NSFW_EMBEDDING_DIM,
  NSFW_METADATA_KEY,
  NSFW_MODEL,
  NSFW_VERSION,
  NsfwMetadata,
  parseEmbedding,
  scoreNsfw,
} from 'src/nsfw/nsfw.js';
import { BaseService } from 'src/services/base.service.js';
import { batched, isSmartSearchEnabled } from 'src/utils/misc.js';

// Fork addition (see FORK.md): scores assets for NSFW content from their existing CLIP embedding.
@Injectable()
export class NsfwService extends BaseService {
  private warnedModel?: string;

  private isEnabled(machineLearning: SystemConfig['machineLearning']) {
    if (!isSmartSearchEnabled(machineLearning)) {
      return false;
    }
    const modelName = machineLearning.clip.modelName;
    if (modelName !== NSFW_CLIP_MODEL) {
      if (this.warnedModel !== modelName) {
        this.warnedModel = modelName;
        this.logger.warn(`NSFW detection only supports CLIP model ${NSFW_CLIP_MODEL}, not ${modelName}; skipping`);
      }
      return false;
    }
    return true;
  }

  @OnJob({ name: JobName.AssetDetectNsfwQueueAll, queue: QueueName.NsfwDetection })
  async handleQueueNsfw({ force }: JobOf<JobName.AssetDetectNsfwQueueAll>): Promise<JobStatus> {
    const { machineLearning } = await this.getConfig({ withCache: false });
    if (!this.isEnabled(machineLearning)) {
      return JobStatus.Skipped;
    }

    for await (const assets of batched(this.assetJobRepository.streamForSearchDuplicates(true))) {
      await this.jobRepository.queueAll(
        assets.map((asset) => ({ name: JobName.AssetDetectNsfw, data: { id: asset.id, force } })),
      );
    }

    return JobStatus.Success;
  }

  @OnJob({ name: JobName.AssetDetectNsfw, queue: QueueName.NsfwDetection })
  async handleNsfw({ id, force }: JobOf<JobName.AssetDetectNsfw>): Promise<JobStatus> {
    const { machineLearning } = await this.getConfig({ withCache: true });
    if (!this.isEnabled(machineLearning)) {
      return JobStatus.Skipped;
    }

    const asset = await this.assetJobRepository.getForSearchDuplicatesJob(id);
    if (!asset) {
      this.logger.error(`Asset ${id} not found`);
      return JobStatus.Failed;
    }

    if (asset.type !== AssetType.Image || asset.visibility === AssetVisibility.Hidden || !asset.embedding) {
      return JobStatus.Skipped;
    }

    if (!force) {
      const existing = await this.assetRepository.getMetadataByKey(id, NSFW_METADATA_KEY);
      if ((existing?.value as Partial<NsfwMetadata> | undefined)?.v === NSFW_VERSION) {
        return JobStatus.Skipped;
      }
    }

    const embedding = parseEmbedding(asset.embedding);
    if (embedding.length !== NSFW_EMBEDDING_DIM) {
      this.logger.debug(`Asset ${id} has a ${embedding.length}-dimensional embedding, skipping`);
      return JobStatus.Skipped;
    }

    const value: NsfwMetadata = { score: scoreNsfw(embedding), model: NSFW_MODEL, v: NSFW_VERSION };
    await this.assetRepository.upsertMetadata(id, [{ key: NSFW_METADATA_KEY, value }]);

    return JobStatus.Success;
  }
}
