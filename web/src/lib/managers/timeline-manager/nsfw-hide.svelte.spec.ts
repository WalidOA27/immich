import { tick } from 'svelte';
import { sdkMock } from '$lib/__mocks__/sdk.mock';
import { nsfwMode } from '$lib/stores/nsfw.store';
import { timelineAssetFactory, toResponseDto } from '@test-data/factories/asset-factory';
import { TimelineManager } from './timeline-manager.svelte';

// Fork addition (see FORK.md)
describe('TimelineManager NSFW hide mode', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    sdkMock.getTimeBuckets.mockResolvedValue([{ count: 1, timeBucket: '2024-01-01' }]);
    sdkMock.getTimeBucket.mockResolvedValue(toResponseDto(...timelineAssetFactory.buildList(1)));
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
