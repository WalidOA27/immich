// Fork addition (see FORK.md): the NSFW Detection card must be in Admin > Queues like every other
// asset job, with All / Missing buttons that send the same commands as the rest.
import { QueueCommand, QueueName, type QueueResponseDto } from '@immich/sdk';
import { within } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { renderWithTooltips as render } from '$tests/helpers';
import QueuePanel from './QueuePanel.svelte';

const flags = vi.hoisted(() => ({ value: { smartSearch: true, duplicateDetection: true } as Record<string, boolean> }));

vi.mock(import('$lib/managers/feature-flags-manager.svelte'), function () {
  return {
    featureFlagsManager: {
      init: vi.fn(),
      loadFeatureFlags: vi.fn(),
      get value() {
        return flags.value;
      },
    } as never,
  };
});

vi.mock(import('$lib/managers/queue-manager.svelte'), function () {
  return { queueManager: { refresh: vi.fn(), listen: vi.fn(), queues: [] } as never };
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

const nsfwCard = (root: HTMLElement) => {
  const link = [...root.querySelectorAll('a')].find((a) => a.getAttribute('href') === '/admin/queues/nsfw-detection');
  expect(link, 'NSFW Detection card').toBeDefined();
  return link!.closest('.rounded-2xl') as HTMLElement;
};

describe('QueuePanel NSFW Detection card (fork)', () => {
  beforeEach(() => {
    flags.value = { smartSearch: true, duplicateDetection: true };
    vi.mocked(runQueueCommandLegacy).mockClear();
  });

  it('is listed right after Duplicate Detection', () => {
    const { container } = render(QueuePanel, {
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

  it('"Missing" queues only unscored assets', async () => {
    const { container } = render(QueuePanel, { queues: [idle(QueueName.NsfwDetection)] });
    await userEvent.click(within(nsfwCard(container)).getByText('missing'));
    expect(runQueueCommandLegacy).toHaveBeenCalledWith({
      name: QueueName.NsfwDetection,
      queueCommandDto: { command: QueueCommand.Start, force: false },
    });
  });

  it('"All" re-scores every asset', async () => {
    const { container } = render(QueuePanel, { queues: [idle(QueueName.NsfwDetection)] });
    await userEvent.click(within(nsfwCard(container)).getByText('all'));
    expect(runQueueCommandLegacy).toHaveBeenCalledWith({
      name: QueueName.NsfwDetection,
      queueCommandDto: { command: QueueCommand.Start, force: true },
    });
  });

  it('is disabled when Smart Search is off (it scores Smart Search embeddings)', () => {
    flags.value = { smartSearch: false, duplicateDetection: true };
    const { container } = render(QueuePanel, { queues: [idle(QueueName.NsfwDetection)] });
    const card = within(nsfwCard(container));
    expect(card.getByText('disabled')).toBeInTheDocument();
    expect(card.queryByText('missing')).toBeNull();
  });
});
