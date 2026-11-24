import { nsfwMode } from '#lib/stores/nsfw.store.ts';
import { factory } from '#test/unit/factories.ts';
import { render } from 'vitest-browser-svelte';
import Thumbnail from '#lib/components/assets/thumbnail/Thumbnail.svelte';

vi.mock('#lib/utils/navigation.ts', () => ({
  currentUrlReplaceAssetId: vi.fn((assetId: string) => `/photos/${assetId}`),
  isSharedLinkRoute: vi.fn().mockReturnValue(false),
  isPhotosRoute: vi.fn().mockReturnValue(false),
  isAlbumsRoute: vi.fn().mockReturnValue(false),
  isPeopleRoute: vi.fn().mockReturnValue(false),
  isLockedFolderRoute: vi.fn().mockReturnValue(false),
  isAssetViewerRoute: vi.fn().mockReturnValue(false),
  getAssetInfoFromParam: vi.fn().mockResolvedValue(undefined),
  navigate: vi.fn().mockResolvedValue(undefined),
  clearQueryParam: vi.fn().mockResolvedValue(undefined),
  setQueryValue: vi.fn().mockResolvedValue(undefined),
}));

const renderWith = async (isNsfw: boolean) => {
  const { baseElement } = await render(Thumbnail, { asset: factory.timelineAsset({ isNsfw }) });
  return baseElement;
};

describe('Thumbnail NSFW blur (fork)', () => {
  afterEach(() => {
    nsfwMode.set('show');
  });

  it('blurs an NSFW asset in blur mode', async () => {
    nsfwMode.set('blur');
    expect((await renderWith(true)).querySelector('.blur-2xl')).not.toBeNull();
  });

  it('also blurs an NSFW asset in hide mode (defense in depth if it slips past the server filter)', async () => {
    nsfwMode.set('hide');
    expect((await renderWith(true)).querySelector('.blur-2xl')).not.toBeNull();
  });

  it('does not blur an NSFW asset in show mode', async () => {
    nsfwMode.set('show');
    expect((await renderWith(true)).querySelector('.blur-2xl')).toBeNull();
  });

  it('does not blur a safe asset in blur mode', async () => {
    nsfwMode.set('blur');
    expect((await renderWith(false)).querySelector('.blur-2xl')).toBeNull();
  });
});
