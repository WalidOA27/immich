// Fork addition (see FORK.md): the NSFW Detection card must be in Admin > Queues like every other
// asset job, with All / Missing buttons that send the same commands as the rest.
import { featureFlagsManager } from '#lib/managers/feature-flags-manager.svelte.ts';
import { queryClient } from '#lib/queries/client.ts';
import { getUserConfigQuery } from '#lib/queries/config-user.query.ts';
import { test } from '#test/unit/fixtures.ts';
import { renderWithTooltips } from '#test/unit/helpers.ts';
import { QueueCommand, QueueName, type QueueResponseDto } from '@immich/sdk';
import { expect } from 'vitest';
import QueuePanel from './QueuePanel.svelte';

const idle = (name: QueueName): QueueResponseDto =>
  ({
    name,
    isPaused: false,
    statistics: { active: 0, completed: 0, failed: 0, delayed: 0, waiting: 0, paused: 0 },
  }) as QueueResponseDto;

const card = (container: HTMLElement) => {
  const link = [...container.querySelectorAll('a')].find(
    (a) => a.getAttribute('href') === '/admin/queues/nsfw-detection',
  );
  expect(link, 'NSFW Detection card').toBeDefined();
  return link!.closest('.rounded-2xl') as HTMLElement;
};

const button = (container: HTMLElement, name: string) =>
  [...card(container).querySelectorAll('button')].find((button) => button.textContent?.trim() === name);

test.beforeEach(async ({ api }) => {
  await queryClient.query(getUserConfigQuery());
  api.on({ getQueues: () => ({ json: [] }), runQueueCommandLegacy: () => ({ status: 204 }) });
});

test.afterEach(() => {
  queryClient.clear();
});

describe('QueuePanel NSFW Detection card (fork)', () => {
  test('is listed right after Duplicate Detection', async () => {
    const { container } = await renderWithTooltips(QueuePanel, {
      queues: [
        idle(QueueName.SmartSearch),
        idle(QueueName.DuplicateDetection),
        idle(QueueName.NsfwDetection),
        idle(QueueName.FaceDetection),
      ],
    });
    const order = [...container.querySelectorAll('a[href^="/admin/queues/"]')]
      .map((a) => a.getAttribute('href'))
      .filter((href, i, all) => all.indexOf(href) === i);
    expect(order).toEqual([
      '/admin/queues/smart-search',
      '/admin/queues/duplicate-detection',
      '/admin/queues/nsfw-detection',
      '/admin/queues/face-detection',
    ]);
  });

  test('"Missing" queues only unscored assets', async ({ api, data, settle }) => {
    data.serverFeatures.smartSearch = true;
    await featureFlagsManager.init();
    const { container } = await renderWithTooltips(QueuePanel, { queues: [idle(QueueName.NsfwDetection)] });
    button(container, 'missing')!.click();
    await settle();
    expect(api.runQueueCommandLegacy).toHaveBeenCalledWith({
      params: { name: QueueName.NsfwDetection },
      body: { command: QueueCommand.Start, force: false },
    });
  });

  test('"All" re-scores every asset', async ({ api, data, settle }) => {
    data.serverFeatures.smartSearch = true;
    await featureFlagsManager.init();
    const { container } = await renderWithTooltips(QueuePanel, { queues: [idle(QueueName.NsfwDetection)] });
    button(container, 'all')!.click();
    await settle();
    expect(api.runQueueCommandLegacy).toHaveBeenCalledWith({
      params: { name: QueueName.NsfwDetection },
      body: { command: QueueCommand.Start, force: true },
    });
  });

  test('is disabled when Smart Search is off (it scores Smart Search embeddings)', async () => {
    const { container } = await renderWithTooltips(QueuePanel, { queues: [idle(QueueName.NsfwDetection)] });
    expect(button(container, 'missing')).toBeUndefined();
    expect(button(container, 'disabled')).toBeDefined();
  });
});
