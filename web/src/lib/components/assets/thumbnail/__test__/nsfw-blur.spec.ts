import Thumbnail from '#lib/components/assets/thumbnail/Thumbnail.svelte';
import { nsfwMode } from '#lib/stores/nsfw.store.ts';
import { factory } from '#test/unit/factories.ts';
import { expect } from 'vitest';
import { render } from 'vitest-browser-svelte';

// Fork addition (see FORK.md): NSFW thumbnails are blurred unless the user chose "show".
const renderThumbnail = async (isNsfw: boolean) => {
  const asset = factory.timelineAsset({ isNsfw });
  const { container } = await render(Thumbnail, { asset });
  return container;
};

describe('Thumbnail NSFW blur (fork)', () => {
  afterEach(() => {
    nsfwMode.set('show');
  });

  it('blurs an NSFW asset in blur mode', async () => {
    nsfwMode.set('blur');
    const container = await renderThumbnail(true);
    expect(container.querySelector('.blur-2xl')).not.toBeNull();
  });

  it('also blurs an NSFW asset in hide mode (defense in depth if it slips past the server filter)', async () => {
    nsfwMode.set('hide');
    const container = await renderThumbnail(true);
    expect(container.querySelector('.blur-2xl')).not.toBeNull();
  });

  it('does not blur an NSFW asset in show mode', async () => {
    nsfwMode.set('show');
    const container = await renderThumbnail(true);
    expect(container.querySelector('.blur-2xl')).toBeNull();
  });

  it('does not blur a safe asset in blur mode', async () => {
    nsfwMode.set('blur');
    const container = await renderThumbnail(false);
    expect(container.querySelector('.blur-2xl')).toBeNull();
  });
});
