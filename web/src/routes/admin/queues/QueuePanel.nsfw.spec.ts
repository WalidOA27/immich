// Fork addition (see FORK.md): the NSFW Detection card must be in Admin > Queues like every other
// asset job, with All / Missing buttons that send the same commands as the rest.
import { queryClient } from '#lib/queries/client.ts';
import { getUserConfigQuery } from '#lib/queries/config-user.query.ts';
import type { MockData } from '#test/common/data.ts';
import { test } from '#test/unit/fixtures.ts';
import { renderWithTooltips } from '#test/unit/helpers.ts';
import type { Mock } from '#test/unit/mocks/mock.ts';
import { QueueCommand, QueueName, type QueueResponseDto } from '@immich/sdk';
import { userEvent } from 'vitest/browser';
import QueuePanel from './QueuePanel.svelte';

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

const cardButton = (card: HTMLElement, text: string) =>
  [...card.querySelectorAll('button')].find((button) => button.textContent?.trim() === text);

describe('QueuePanel NSFW Detection card (fork)', () => {
  beforeEach<{ api: Mock['api']; data: MockData }>(async ({ api, data }) => {
    data.userConfig.machineLearning.enabled = true;
    data.userConfig.machineLearning.clip.enabled = true;
    api.on({
      getQueues: () => ({ json: [] }),
      runQueueCommandLegacy: () => ({ status: 204 }),
    });
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

  test('"Missing" queues only unscored assets', async ({ api, settle }) => {
    const { baseElement } = await renderWithTooltips(QueuePanel, { queues: [idle(QueueName.NsfwDetection)] });
    await userEvent.click(cardButton(nsfwCard(baseElement), 'missing')!);
    await settle();
    expect(api.runQueueCommandLegacy).toHaveBeenCalledWith({
      params: { name: QueueName.NsfwDetection },
      body: { command: QueueCommand.Start, force: false },
    });
  });

  test('"All" re-scores every asset', async ({ api, settle }) => {
    const { baseElement } = await renderWithTooltips(QueuePanel, { queues: [idle(QueueName.NsfwDetection)] });
    await userEvent.click(cardButton(nsfwCard(baseElement), 'all')!);
    await settle();
    expect(api.runQueueCommandLegacy).toHaveBeenCalledWith({
      params: { name: QueueName.NsfwDetection },
      body: { command: QueueCommand.Start, force: true },
    });
  });

  test('is disabled when Smart Search is off (it scores Smart Search embeddings)', async ({ data }) => {
    data.userConfig.machineLearning.clip.enabled = false;
    queryClient.removeQueries({ queryKey: getUserConfigQuery().queryKey });
    await queryClient.query(getUserConfigQuery());
    const { baseElement } = await renderWithTooltips(QueuePanel, { queues: [idle(QueueName.NsfwDetection)] });
    const card = nsfwCard(baseElement);
    expect(cardButton(card, 'disabled')).toBeDefined();
    expect(cardButton(card, 'missing')).toBeUndefined();
  });
});
