import { nsfwMode } from '#lib/stores/nsfw.store.ts';
import { test } from '#test/unit/fixtures.ts';
import type { Mock } from '#test/unit/mocks/mock.ts';
import type { TimeBucketAssetResponseDto } from '@immich/sdk';
import { tick } from 'svelte';
import { expect } from 'vitest';
import { TimelineManager } from './timeline-manager.svelte.ts';

// Fork addition (see FORK.md): in hide mode the timeline asks the server to exclude NSFW assets.
const timeBucket = '2024-01-01T00:00:00.000Z';

const bucket: TimeBucketAssetResponseDto = {
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

const load = async (api: Mock['api']) => {
  api.on({
    getTimeBuckets: () => ({ json: [{ count: 1, timeBucket }] }),
    getTimeBucket: () => ({ json: bucket }),
  });

  const timelineManager = new TimelineManager();
  await timelineManager.updateViewport({ width: 1588, height: 1000 });
  await tick();
  await timelineManager.loadTimelineMonth({ year: 2024, month: 1 });
};

describe('TimelineManager NSFW hide mode (fork)', () => {
  test.afterEach(() => {
    nsfwMode.set('show');
  });

  test('asks the server to exclude NSFW assets in hide mode', async ({ api }) => {
    nsfwMode.set('hide');
    await load(api);
    expect(api.getTimeBuckets).toHaveBeenCalledWith({ params: expect.objectContaining({ withoutNsfw: true }) });
    expect(api.getTimeBucket).toHaveBeenCalledWith({ params: expect.objectContaining({ withoutNsfw: true }) });
  });

  for (const mode of ['show', 'blur'] as const) {
    test(`does not filter in ${mode} mode`, async ({ api }) => {
      nsfwMode.set(mode);
      await load(api);
      expect(api.getTimeBuckets.calls.every((call) => call.params?.withoutNsfw !== true)).toBe(true);
      expect(api.getTimeBucket.calls.every((call) => call.params?.withoutNsfw !== true)).toBe(true);
    });
  }
});
