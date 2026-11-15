// Fork addition (see FORK.md): the NSFW Detection card must be in Admin > Queues like every other
// asset job, with All / Missing buttons that send the same commands as the rest.
import { queryClient } from '#lib/queries/client.ts';
import { getUserConfigQuery } from '#lib/queries/config-user.query.ts';
import { test } from '#test/unit/fixtures.ts';
import { renderWithTooltips } from '#test/unit/helpers.ts';
import { QueueCommand, QueueName, type QueueResponseDto } from '@immich/sdk';
import { tick } from 'svelte';
import QueuePanel from './QueuePanel.svelte';

vi.mock('#lib/managers/queue-manager.svelte.ts', () => ({
  queueManager: { refresh: vi.fn(), listen: vi.fn(), queues: [] },
}));

const idle = (name: QueueName): QueueResponseDto =>
  ({
    name,
    isPaused: false,
    statistics: { active: 0, completed: 0, failed: 0, delayed: 0, waiting: 0, paused: 0 },
  }) as QueueResponseDto;

const nsfwCard = (root: HTMLElement) => {
  const link = [...root.querySelectorAll('a')].find((a) => a.getAttribute('href') === '/admin/queues/nsfw-detection');
  expect(link, 'NSFW Detection card').toBeDefined();
  return link!.closest('.rounded-2xl') as HTMLElement;
};

test.describe('QueuePanel NSFW Detection card (fork)', () => {
  test.beforeEach(async ({ api, data }) => {
    data.userConfig.machineLearning.enabled = true;
    api.on({ runQueueCommandLegacy: () => ({ status: 204 }), getQueues: () => ({ json: [] }) });
    await queryClient.query(getUserConfigQuery());
  });

  test('is listed right after Duplicate Detection', async () => {
    const { baseElement } = await renderWithTooltips(QueuePanel, {
      queues: [
        idle(QueueName.SmartSearch),
        idle(QueueName.DuplicateDetection),
        idle(QueueName.NsfwDetection),
        idle(QueueName.FaceDetection),
      ],
    });
    const order = [...baseElement.querySelectorAll('a[href^="/admin/queues/"]')]
      .map((a) => a.getAttribute('href'))
      .filter((href, i, all) => all.indexOf(href) === i);
    expect(order).toEqual([
      '/admin/queues/smart-search',
      '/admin/queues/duplicate-detection',
      '/admin/queues/nsfw-detection',
      '/admin/queues/face-detection',
    ]);
  });

  test('"Missing" queues only unscored assets', async ({ api }) => {
    const { baseElement } = await renderWithTooltips(QueuePanel, { queues: [idle(QueueName.NsfwDetection)] });
    const buttons = [...nsfwCard(baseElement).querySelectorAll('button')];
    const missing = buttons.find((button) => button.textContent?.includes('missing'))!;
    missing.click();
    await tick();
    expect(api.runQueueCommandLegacy).toHaveBeenCalledWith({
      params: { name: QueueName.NsfwDetection },
      body: { command: QueueCommand.Start, force: false },
    });
  });

  test('"All" re-scores every asset', async ({ api }) => {
    const { baseElement } = await renderWithTooltips(QueuePanel, { queues: [idle(QueueName.NsfwDetection)] });
    const buttons = [...nsfwCard(baseElement).querySelectorAll('button')];
    const all = buttons.find((button) => button.textContent?.includes('all'))!;
    all.click();
    await tick();
    expect(api.runQueueCommandLegacy).toHaveBeenCalledWith({
      params: { name: QueueName.NsfwDetection },
      body: { command: QueueCommand.Start, force: true },
    });
  });

  test('is disabled when Smart Search is off (it scores Smart Search embeddings)', async ({ data }) => {
    data.userConfig.machineLearning.enabled = false;
    queryClient.setQueryData(getUserConfigQuery().queryKey, data.userConfig);
    const { baseElement } = await renderWithTooltips(QueuePanel, { queues: [idle(QueueName.NsfwDetection)] });
    const card = nsfwCard(baseElement);
    expect(card.textContent).toContain('disabled');
    expect(card.textContent).not.toContain('missing');
  });
});
