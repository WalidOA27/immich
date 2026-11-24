// Fork addition (see FORK.md): the NSFW Detection card must be in Admin > Queues like every other
// asset job, with All / Missing buttons that send the same commands as the rest.
import { QueueCommand, QueueName, type QueueResponseDto } from '@immich/sdk';
import { renderWithTooltips as render } from '#test/unit/helpers.ts';
import QueuePanel from './QueuePanel.svelte';

const config = vi.hoisted(() => ({
  value: {
    machineLearning: {
      clip: { enabled: true },
      duplicateDetection: { enabled: true },
      facialRecognition: { enabled: true },
      ocr: { enabled: true },
    },
  },
}));

vi.mock(import('#lib/queries/client.ts'), async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, createPreloadedQuery: () => ({ data: config.value }) as never };
});

vi.mock(import('#lib/managers/queue-manager.svelte.ts'), function () {
  return { queueManager: { refresh: vi.fn(), listen: vi.fn(), queues: [] } } as never;
});

vi.mock(import('@immich/sdk'), async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, runQueueCommandLegacy: vi.fn().mockResolvedValue({}) };
});

const { runQueueCommandLegacy } = await import('@immich/sdk');

const idle = (name: QueueName): QueueResponseDto =>
  ({
    name,
    isPaused: false,
    statistics: { active: 0, completed: 0, failed: 0, delayed: 0, waiting: 0, paused: 0 },
  }) as QueueResponseDto;

const nsfwCard = (root: ParentNode) => {
  const link = root.querySelector('a[href="/admin/queues/nsfw-detection"]');
  expect(link, 'NSFW Detection card').not.toBeNull();
  return link!.closest('.rounded-2xl') as HTMLElement;
};

const buttonLabels = (root: ParentNode) =>
  [...root.querySelectorAll('button')].map((button) => button.textContent?.trim());

describe('QueuePanel NSFW Detection card (fork)', () => {
  beforeEach(() => {
    config.value = {
      machineLearning: {
        clip: { enabled: true },
        duplicateDetection: { enabled: true },
        facialRecognition: { enabled: true },
        ocr: { enabled: true },
      },
    };
    vi.mocked(runQueueCommandLegacy).mockClear();
  });

  it('is listed right after Duplicate Detection', async () => {
    const { baseElement } = await render(QueuePanel, {
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

  it('"Missing" queues only unscored assets', async () => {
    const { baseElement } = await render(QueuePanel, { queues: [idle(QueueName.NsfwDetection)] });
    const missing = [...nsfwCard(baseElement).querySelectorAll('button')].find(
      (button) => button.textContent?.trim() === 'missing',
    );
    expect(missing).toBeDefined();
    missing!.click();
    await vi.waitFor(() =>
      expect(runQueueCommandLegacy).toHaveBeenCalledWith({
        name: QueueName.NsfwDetection,
        queueCommandDto: { command: QueueCommand.Start, force: false },
      }),
    );
  });

  it('"All" re-scores every asset', async () => {
    const { baseElement } = await render(QueuePanel, { queues: [idle(QueueName.NsfwDetection)] });
    const all = [...nsfwCard(baseElement).querySelectorAll('button')].find(
      (button) => button.textContent?.trim() === 'all',
    );
    expect(all).toBeDefined();
    all!.click();
    await vi.waitFor(() =>
      expect(runQueueCommandLegacy).toHaveBeenCalledWith({
        name: QueueName.NsfwDetection,
        queueCommandDto: { command: QueueCommand.Start, force: true },
      }),
    );
  });

  it('is disabled when Smart Search is off (it scores Smart Search embeddings)', async () => {
    config.value = {
      machineLearning: {
        clip: { enabled: false },
        duplicateDetection: { enabled: true },
        facialRecognition: { enabled: true },
        ocr: { enabled: true },
      },
    };
    const { baseElement } = await render(QueuePanel, { queues: [idle(QueueName.NsfwDetection)] });
    const card = nsfwCard(baseElement);
    expect(buttonLabels(card)).toContain('disabled');
    expect(buttonLabels(card)).not.toContain('missing');
  });
});
