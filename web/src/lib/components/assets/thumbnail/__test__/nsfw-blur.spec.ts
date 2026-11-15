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
    expect((await renderThumbnail(true)).querySelector('.blur-2xl')).not.toBeNull();
  });

  it('does not blur an NSFW asset in show mode', async () => {
    nsfwMode.set('show');
    expect((await renderThumbnail(true)).querySelector('.blur-2xl')).toBeNull();
  });

  it('does not blur a safe asset in blur mode', async () => {
    nsfwMode.set('blur');
    expect((await renderThumbnail(false)).querySelector('.blur-2xl')).toBeNull();
  });

  it('blurs an NSFW asset in hide mode too', async () => {
    nsfwMode.set('hide');
    expect((await renderThumbnail(true)).querySelector('.blur-2xl')).not.toBeNull();
  });
});
