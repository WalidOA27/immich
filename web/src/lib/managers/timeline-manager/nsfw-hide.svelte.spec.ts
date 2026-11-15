import { nsfwMode } from '#lib/stores/nsfw.store.ts';
import { fromISODateTimeUTCToObject, fromTimelinePlainDateTime } from '#lib/utils/timeline-util.ts';
import { factory } from '#test/unit/factories.ts';
import { test } from '#test/unit/fixtures.ts';
import type { Mock } from '#test/unit/mocks/mock.ts';
import type { TimeBucketAssetResponseDto } from '@immich/sdk';
import { tick } from 'svelte';
import { TimelineManager } from './timeline-manager.svelte';
import type { TimelineAsset } from './types';

// Fork addition (see FORK.md)

const monthAsset = (): TimelineAsset => {
  const fileCreatedAt = fromISODateTimeUTCToObject('2024-01-15T00:00:00.000Z');
  return { ...factory.timelineAsset(), fileCreatedAt, localDateTime: fileCreatedAt };
};

const toResponseDto = (assets: TimelineAsset[]): TimeBucketAssetResponseDto => ({
  id: assets.map((asset) => asset.id),
  ownerId: assets.map((asset) => asset.ownerId),
  ratio: assets.map((asset) => asset.ratio),
  thumbhash: assets.map((asset) => asset.thumbhash),
  createdAt: assets.map((asset) => fromTimelinePlainDateTime(asset.createdAt).toISO()),
  fileCreatedAt: assets.map((asset) => fromTimelinePlainDateTime(asset.fileCreatedAt).toISO()),
  localOffsetHours: assets.map(() => 0),
  isFavorite: assets.map((asset) => asset.isFavorite),
  isTrashed: assets.map((asset) => asset.isTrashed),
  isImage: assets.map((asset) => asset.isImage),
  isNsfw: assets.map((asset) => asset.isNsfw ?? false),
  duration: assets.map((asset) => asset.duration ?? null),
  projectionType: assets.map((asset) => asset.projectionType ?? null),
  livePhotoVideoId: assets.map((asset) => asset.livePhotoVideoId ?? null),
  city: assets.map((asset) => asset.city ?? null),
  country: assets.map((asset) => asset.country ?? null),
  visibility: assets.map((asset) => asset.visibility),
  stack: assets.map((asset) => (asset.stack ? [asset.stack.id, String(asset.stack.assetCount)] : null)),
});

const load = async (api: Mock['api']) => {
  const timelineManager = new TimelineManager();
  await timelineManager.updateViewport({ width: 1588, height: 1000 });
  await tick();
  await timelineManager.loadTimelineMonth({ year: 2024, month: 1 });
  expect(api.getTimeBuckets.calls).toHaveLength(1);
  expect(api.getTimeBucket.calls).toHaveLength(1);
  return { buckets: api.getTimeBuckets.calls[0], bucket: api.getTimeBucket.calls[0] };
};

describe('TimelineManager NSFW hide mode', () => {
  beforeEach<{ api: Mock['api'] }>(({ api }) => {
    api.on({
      getTimeBuckets: () => ({ json: [{ count: 1, timeBucket: '2024-01-01T00:00:00.000Z' }] }),
      getTimeBucket: () => ({ json: toResponseDto([monthAsset()]) }),
    });
  });

  afterEach(() => {
    nsfwMode.set('show');
  });

  test('asks the server to exclude NSFW assets in hide mode', async ({ api }) => {
    nsfwMode.set('hide');
    const { buckets, bucket } = await load(api);
    expect(buckets.params?.withoutNsfw).toBe(true);
    expect(bucket.params.withoutNsfw).toBe(true);
  });

  for (const mode of ['show', 'blur'] as const) {
    test(`does not filter in ${mode} mode`, async ({ api }) => {
      nsfwMode.set(mode);
      const { buckets, bucket } = await load(api);
      expect(buckets.params?.withoutNsfw).toBeUndefined();
      expect(bucket.params.withoutNsfw).toBeUndefined();
    });
  }
});
