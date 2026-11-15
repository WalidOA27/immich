import Thumbnail from '#lib/components/assets/thumbnail/Thumbnail.svelte';
import { nsfwMode } from '#lib/stores/nsfw.store.ts';
import { factory } from '#test/unit/factories.ts';
import { render } from 'vitest-browser-svelte';

const renderWith = (isNsfw: boolean) => {
  const asset = factory.timelineAsset({ isNsfw });
  return render(Thumbnail, { asset });
};

describe('Thumbnail NSFW blur (fork)', () => {
  afterEach(() => {
    nsfwMode.set('show');
  });

  it('blurs an NSFW asset in blur mode', async () => {
    nsfwMode.set('blur');
    const { baseElement } = await renderWith(true);
    expect(baseElement.querySelector('.blur-2xl')).not.toBeNull();
  });

  it('also blurs an NSFW asset in hide mode (defense in depth if it slips past the server filter)', async () => {
    nsfwMode.set('hide');
    const { baseElement } = await renderWith(true);
    expect(baseElement.querySelector('.blur-2xl')).not.toBeNull();
  });

  it('does not blur an NSFW asset in show mode', async () => {
    nsfwMode.set('show');
    const { baseElement } = await renderWith(true);
    expect(baseElement.querySelector('.blur-2xl')).toBeNull();
  });

  it('does not blur a safe asset in blur mode', async () => {
    nsfwMode.set('blur');
    const { baseElement } = await renderWith(false);
    expect(baseElement.querySelector('.blur-2xl')).toBeNull();
  });
});
