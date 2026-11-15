import { nsfwMode } from '#lib/stores/nsfw.store.ts';
import { fromISODateTimeUTCToObject, fromTimelinePlainDateTime } from '#lib/utils/timeline-util.ts';
import { factory } from '#test/unit/factories.ts';
import { test } from '#test/unit/fixtures.ts';
import type { TimeBucketAssetResponseDto } from '@immich/sdk';
import { tick } from 'svelte';
import { TimelineManager } from './timeline-manager.svelte';
import type { TimelineAsset } from './types';

// Fork addition (see FORK.md)
const toResponseDto = (...timelineAsset: TimelineAsset[]) => {
  const bucketAssets: TimeBucketAssetResponseDto = {
    city: [],
    country: [],
    duration: [],
    id: [],
    visibility: [],
    isFavorite: [],
    isImage: [],
    isTrashed: [],
    isNsfw: [],
    livePhotoVideoId: [],
    fileCreatedAt: [],
    localOffsetHours: [],
    createdAt: [],
    ownerId: [],
    projectionType: [],
    ratio: [],
    stack: [],
    thumbhash: [],
  };
  for (const asset of timelineAsset) {
    bucketAssets.city?.push(asset.city);
    bucketAssets.country?.push(asset.country);
    bucketAssets.duration.push(asset.duration!);
    bucketAssets.id.push(asset.id);
    bucketAssets.visibility.push(asset.visibility);
    bucketAssets.isFavorite.push(asset.isFavorite);
    bucketAssets.isImage.push(asset.isImage);
    bucketAssets.isTrashed.push(asset.isTrashed);
    bucketAssets.isNsfw.push(asset.isNsfw ?? false);
    bucketAssets.localOffsetHours.push(0);
    bucketAssets.livePhotoVideoId.push(asset.livePhotoVideoId!);
    bucketAssets.fileCreatedAt.push(fromTimelinePlainDateTime(asset.fileCreatedAt).toISO()!);
    bucketAssets.ownerId.push(asset.ownerId);
    bucketAssets.projectionType.push(asset.projectionType!);
    bucketAssets.ratio.push(asset.ratio);
    bucketAssets.stack?.push(asset.stack ? [asset.stack.id, asset.stack.assetCount.toString()] : null);
    bucketAssets.thumbhash.push(asset.thumbhash!);
  }

  return bucketAssets;
};

const load = async () => {
  const timelineManager = new TimelineManager();
  await timelineManager.updateViewport({ width: 1588, height: 0 });
  await tick();
  await timelineManager.loadTimelineMonth({ year: 2024, month: 1 });
};

test.describe('TimelineManager NSFW hide mode', () => {
  test.beforeEach(({ api }) => {
    api.on({
      getTimeBuckets: () => ({ json: [{ count: 1, timeBucket: '2024-01-01' }] }),
      getTimeBucket: () => ({
        json: toResponseDto(
          ...factory.many(1, () =>
            factory.timelineAsset({ fileCreatedAt: fromISODateTimeUTCToObject('2024-01-15T00:00:00.000Z') }),
          ),
        ),
      }),
    });
  });

  test.afterEach(() => {
    nsfwMode.set('show');
  });

  test('asks the server to exclude NSFW assets in hide mode', async ({ api }) => {
    nsfwMode.set('hide');
    await load();
    expect(api.getTimeBuckets.calls).toHaveLength(1);
    expect(api.getTimeBuckets.calls[0].params).toMatchObject({ withoutNsfw: true });
    expect(api.getTimeBucket.calls).toHaveLength(1);
    expect(api.getTimeBucket.calls[0].params).toMatchObject({ withoutNsfw: true });
  });

  for (const mode of ['show', 'blur'] as const) {
    test(`does not filter in ${mode} mode`, async ({ api }) => {
      nsfwMode.set(mode);
      await load();
      expect(api.getTimeBuckets.calls).toHaveLength(1);
      expect(api.getTimeBuckets.calls[0].params?.withoutNsfw).toBeUndefined();
      expect(api.getTimeBucket.calls).toHaveLength(1);
      expect(api.getTimeBucket.calls[0].params?.withoutNsfw).toBeUndefined();
    });
  }
});
