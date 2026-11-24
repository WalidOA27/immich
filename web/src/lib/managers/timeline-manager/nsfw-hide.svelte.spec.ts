import { nsfwMode } from '#lib/stores/nsfw.store.ts';
import { fromTimelinePlainDateTime } from '#lib/utils/timeline-util.ts';
import { factory } from '#test/unit/factories.ts';
import type { TimeBucketAssetResponseDto } from '@immich/sdk';
import { tick } from 'svelte';
import type { MockedObject } from 'vitest';
import { TimelineManager } from './timeline-manager.svelte';
import type { TimelineAsset } from './types';

vi.mock('@immich/sdk', async (importOriginal) => {
  const module = await importOriginal<typeof import('@immich/sdk')>();
  const mocks = Object.fromEntries(
    Object.entries(module)
      .filter(([, value]) => typeof value === 'function')
      .map(([key]) => [key, vi.fn()]),
  );
  const mock = { ...module, ...mocks };
  return { ...mock, default: mock };
});

const sdkMock = (await import('@immich/sdk')) as unknown as MockedObject<typeof import('@immich/sdk')>;

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

// Fork addition (see FORK.md)
describe('TimelineManager NSFW hide mode', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    sdkMock.getTimeBuckets.mockResolvedValue([{ count: 1, timeBucket: '2024-01-01' }]);
    sdkMock.getTimeBucket.mockResolvedValue(toResponseDto(factory.timelineAsset()));
  });

  afterEach(() => {
    nsfwMode.set('show');
  });

  const load = async () => {
    const timelineManager = new TimelineManager();
    await timelineManager.updateViewport({ width: 1588, height: 1000 });
    await tick();
    await timelineManager.loadTimelineMonth({ year: 2024, month: 1 });
  };

  it('asks the server to exclude NSFW assets in hide mode', async () => {
    nsfwMode.set('hide');
    await load();
    expect(sdkMock.getTimeBuckets).toHaveBeenCalledWith(expect.objectContaining({ withoutNsfw: true }));
    expect(sdkMock.getTimeBucket).toHaveBeenCalledWith(
      expect.objectContaining({ withoutNsfw: true }),
      expect.anything(),
    );
  });

  it.each(['show', 'blur'] as const)('does not filter in %s mode', async (mode) => {
    nsfwMode.set(mode);
    await load();
    expect(sdkMock.getTimeBuckets).toHaveBeenCalledWith(expect.not.objectContaining({ withoutNsfw: true }));
    expect(sdkMock.getTimeBucket).toHaveBeenCalledWith(
      expect.not.objectContaining({ withoutNsfw: true }),
      expect.anything(),
    );
  });
});
