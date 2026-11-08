import Thumbnail from '#lib/components/assets/thumbnail/Thumbnail.svelte';
import { nsfwMode } from '#lib/stores/nsfw.store.ts';
import { factory } from '#test/unit/factories.ts';
import { test } from '#test/unit/fixtures.ts';
import { render } from 'vitest-browser-svelte';

// Fork addition (see FORK.md)

const renderWith = async (isNsfw: boolean) => {
  const { baseElement } = await render(Thumbnail, { asset: factory.timelineAsset({ isNsfw }) });
  return baseElement;
};

describe('Thumbnail NSFW blur (fork)', () => {
  afterEach(() => {
    nsfwMode.set('show');
  });

  test('blurs an NSFW asset in blur mode', async () => {
    nsfwMode.set('blur');
    expect((await renderWith(true)).querySelector('.blur-2xl')).not.toBeNull();
  });

  test('also blurs an NSFW asset in hide mode (defense in depth if it slips past the server filter)', async () => {
    nsfwMode.set('hide');
    expect((await renderWith(true)).querySelector('.blur-2xl')).not.toBeNull();
  });

  test('does not blur an NSFW asset in show mode', async () => {
    nsfwMode.set('show');
    expect((await renderWith(true)).querySelector('.blur-2xl')).toBeNull();
  });

  test('does not blur a safe asset in blur mode', async () => {
    nsfwMode.set('blur');
    expect((await renderWith(false)).querySelector('.blur-2xl')).toBeNull();
  });
});
