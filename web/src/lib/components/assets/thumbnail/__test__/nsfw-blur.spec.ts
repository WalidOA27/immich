import { render } from '@testing-library/svelte';
import { getIntersectionObserverMock } from '$lib/__mocks__/intersection-observer.mock';
import Thumbnail from '$lib/components/assets/thumbnail/Thumbnail.svelte';
import { nsfwMode } from '$lib/stores/nsfw.store';
import { assetFactory } from '@test-data/factories/asset-factory';

vi.mock('$lib/utils/navigation', () => ({
  currentUrlReplaceAssetId: vi.fn(),
  isSharedLinkRoute: vi.fn().mockReturnValue(false),
}));

vi.hoisted(() => {
  Object.defineProperty(globalThis, 'matchMedia', {
    writable: true,
    enumerable: true,
    value: vi.fn().mockImplementation((query) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
});

const renderWith = (isNsfw: boolean) => {
  const asset = { ...assetFactory.build({ originalPath: 'image.jpg', originalMimeType: 'image/jpeg' }), isNsfw };
  return render(Thumbnail, { asset }).baseElement;
};

describe('Thumbnail NSFW blur (fork)', () => {
  beforeAll(() => {
    vi.stubGlobal('IntersectionObserver', getIntersectionObserverMock());
  });

  afterEach(() => {
    nsfwMode.set('show');
  });

  it('blurs an NSFW asset in blur mode', () => {
    nsfwMode.set('blur');
    expect(renderWith(true).querySelector('.blur-2xl')).not.toBeNull();
  });

  it('does not blur an NSFW asset in show mode', () => {
    nsfwMode.set('show');
    expect(renderWith(true).querySelector('.blur-2xl')).toBeNull();
  });

  it('does not blur a safe asset in blur mode', () => {
    nsfwMode.set('blur');
    expect(renderWith(false).querySelector('.blur-2xl')).toBeNull();
  });
});
