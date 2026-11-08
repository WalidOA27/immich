import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AssetType, AssetVisibility, JobName, JobStatus } from 'src/enum.js';
import { NsfwService } from 'src/services/nsfw.service.js';
import { AssetFactory } from 'test/factories/asset.factory.js';
import { ServiceMocks, makeStream, newTestService } from 'test/utils.js';

const fixture = JSON.parse(readFileSync(new URL('../nsfw/nsfw.fixture.json', import.meta.url), 'utf8')) as {
  cases: Array<{ embedding: number[]; score: number }>;
};
const highCase = fixture.cases[3]; // score ≈ 0.8

const image = {
  id: 'asset-1',
  ownerId: 'user-id',
  stackId: null,
  type: AssetType.Image,
  duplicateId: null,
  embedding: JSON.stringify(highCase.embedding),
  visibility: AssetVisibility.Timeline,
};

const enabledConfig = { machineLearning: { enabled: true, clip: { enabled: true } } };

describe(NsfwService.name, () => {
  let sut: NsfwService;
  let mocks: ServiceMocks;

  beforeEach(() => {
    ({ sut, mocks } = newTestService(NsfwService));
    mocks.systemMetadata.get.mockResolvedValue(enabledConfig);
  });

  describe('onBootstrap', () => {
    afterEach(() => {
      delete process.env.IMMICH_NSFW_THRESHOLD;
    });

    it('warns about an invalid IMMICH_NSFW_THRESHOLD', () => {
      process.env.IMMICH_NSFW_THRESHOLD = 'bad-value';
      sut.onBootstrap();
      expect(mocks.logger.warn).toHaveBeenCalledWith(expect.stringContaining('bad-value'));
    });

    it('does not warn for a valid threshold', () => {
      process.env.IMMICH_NSFW_THRESHOLD = '0.6';
      sut.onBootstrap();
      expect(mocks.logger.warn).not.toHaveBeenCalled();
    });
  });

  describe('handleQueueNsfw', () => {
    it('queues one job per asset with an embedding, passing force through', async () => {
      const asset = AssetFactory.create();
      mocks.assetJob.streamForSearchDuplicates.mockReturnValue(makeStream([asset]));

      await expect(sut.handleQueueNsfw({ force: false })).resolves.toBe(JobStatus.Success);

      expect(mocks.assetJob.streamForSearchDuplicates).toHaveBeenCalledWith(true);
      expect(mocks.job.queueAll).toHaveBeenCalledWith([
        { name: JobName.AssetDetectNsfw, data: { id: asset.id, force: false } },
      ]);
    });

    it('skips when smart search is disabled', async () => {
      mocks.systemMetadata.get.mockResolvedValue({ machineLearning: { enabled: true, clip: { enabled: false } } });

      await expect(sut.handleQueueNsfw({})).resolves.toBe(JobStatus.Skipped);
      expect(mocks.job.queueAll).not.toHaveBeenCalled();
    });
  });

  describe('handleNsfw', () => {
    beforeEach(() => {
      mocks.assetJob.getForSearchDuplicatesJob.mockResolvedValue(image);
      mocks.asset.getMetadataByKey.mockResolvedValue(undefined);
    });

    it('skips when smart search is disabled', async () => {
      mocks.systemMetadata.get.mockResolvedValue({ machineLearning: { enabled: false } });

      await expect(sut.handleNsfw({ id: image.id })).resolves.toBe(JobStatus.Skipped);
      expect(mocks.asset.upsertMetadata).not.toHaveBeenCalled();
    });

    it('skips when the CLIP model is not ViT-B-32__openai', async () => {
      mocks.systemMetadata.get.mockResolvedValue({
        machineLearning: { enabled: true, clip: { enabled: true, modelName: 'ViT-L-14__openai' } },
      });

      await expect(sut.handleNsfw({ id: image.id })).resolves.toBe(JobStatus.Skipped);
      expect(mocks.asset.upsertMetadata).not.toHaveBeenCalled();
    });

    it('fails when the asset does not exist', async () => {
      mocks.assetJob.getForSearchDuplicatesJob.mockResolvedValue(undefined);

      await expect(sut.handleNsfw({ id: image.id })).resolves.toBe(JobStatus.Failed);
    });

    it.each([
      ['a video', { type: AssetType.Video }],
      ['a hidden asset', { visibility: AssetVisibility.Hidden }],
      ['an asset without embedding', { embedding: null }],
      [
        'an embedding that is not 512-dimensional',
        { embedding: JSON.stringify(Array.from({ length: 768 }, () => 0.01)) },
      ],
    ])('skips %s without writing metadata', async (_, override) => {
      mocks.assetJob.getForSearchDuplicatesJob.mockResolvedValue({ ...image, ...override });

      await expect(sut.handleNsfw({ id: image.id })).resolves.toBe(JobStatus.Skipped);
      expect(mocks.asset.upsertMetadata).not.toHaveBeenCalled();
    });

    it('skips without force when a current score exists', async () => {
      mocks.asset.getMetadataByKey.mockResolvedValue({
        key: 'nsfw',
        value: { score: 0.1, model: 'laion-clip-b32', v: 1 },
        updatedAt: new Date(),
      });

      await expect(sut.handleNsfw({ id: image.id })).resolves.toBe(JobStatus.Skipped);
      expect(mocks.asset.upsertMetadata).not.toHaveBeenCalled();
    });

    it('rescores with force even when a score exists', async () => {
      mocks.asset.getMetadataByKey.mockResolvedValue({
        key: 'nsfw',
        value: { score: 0.1, model: 'laion-clip-b32', v: 1 },
        updatedAt: new Date(),
      });

      await expect(sut.handleNsfw({ id: image.id, force: true })).resolves.toBe(JobStatus.Success);
      expect(mocks.asset.upsertMetadata).toHaveBeenCalledWith(image.id, [
        {
          key: 'nsfw',
          value: { score: expect.closeTo(highCase.score, 4), model: 'laion-clip-b32', v: 1 },
        },
      ]);
    });

    it('scores an asset without a previous score', async () => {
      await expect(sut.handleNsfw({ id: image.id })).resolves.toBe(JobStatus.Success);
      expect(mocks.asset.upsertMetadata).toHaveBeenCalledWith(image.id, [
        {
          key: 'nsfw',
          value: { score: expect.closeTo(highCase.score, 4), model: 'laion-clip-b32', v: 1 },
        },
      ]);
    });
  });
});
