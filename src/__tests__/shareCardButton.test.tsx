import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ShareCardButton } from '../components/ShareCardButton';
import type { WorkoutSession } from '../types/index';

/**
 * Issue #337 — saving the row as a picture.
 *
 * The card is drawn in the browser and downloaded from it; nothing is posted
 * anywhere, so there is no service to be offline and no account to have.
 */

const downloads = vi.hoisted(() => ({ calls: [] as { mime: string; name: string }[] }));

vi.mock('../utils/exporters', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils/exporters')>();
  return {
    ...actual,
    triggerBlobDownload: (_content: BlobPart, mime: string, name: string) => {
      downloads.calls.push({ mime, name });
    },
  };
});

const session = (): WorkoutSession =>
  ({
    id: 's1',
    routeId: 'willowbrook',
    routeName: 'Willowbrook River',
    startTime: new Date('2026-09-24T09:12:00Z'),
    duration: 1274,
    distance: 5000,
    averagePace: 127,
    calories: 320,
    samples: [],
    splits: [],
    isActive: false,
  }) as WorkoutSession;

/** jsdom has no 2D canvas, so the drawing surface is stood in for. */
const giveCanvasA2dContext = () => {
  const ctx = new Proxy(
    { canvas: {}, measureText: () => ({ width: 100 }), createLinearGradient: () => ({ addColorStop: () => {} }) },
    { get: (target, prop) => (prop in target ? Reflect.get(target, prop) : () => {}), set: () => true },
  );
  stubGetContext(ctx as unknown as CanvasRenderingContext2D);
};

/** `getContext` is overloaded per context type; the stub answers for 2D only. */
const stubGetContext = (value: CanvasRenderingContext2D | null) =>
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(value as never);

beforeEach(() => {
  downloads.calls = [];
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the share card button', () => {
  it('downloads the row as a PNG named after the route', async () => {
    giveCanvasA2dContext();
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((cb: BlobCallback) => {
      cb(new Blob(['png'], { type: 'image/png' }));
    });

    render(<ShareCardButton session={session()} />);
    await userEvent.click(screen.getByRole('button', { name: /share/i }));

    await waitFor(() => expect(downloads.calls).toHaveLength(1));
    expect(downloads.calls[0]).toEqual({
      mime: 'image/png',
      name: 'virtualrow-willowbrook-river-2026-09-24.png',
    });
  });

  /**
   * A failed picture is not a failed row.
   *
   * The rower has just finished 5 km and the summary is the only place that
   * row exists until it is saved, so a card that cannot be drawn says so and
   * says that clearly, rather than looking like the row went missing.
   */
  it('says the row is safe when the picture cannot be drawn', async () => {
    stubGetContext(null);

    render(<ShareCardButton session={session()} />);
    await userEvent.click(screen.getByRole('button', { name: /share/i }));

    const problem = await screen.findByRole('alert');
    expect(problem).toHaveTextContent(/row is safe/i);
    expect(downloads.calls).toHaveLength(0);
  });

  // Drawing a 1200x630 canvas takes a moment on a phone, and a button that
  // looks inert invites a second and third card.
  it('cannot be pressed twice into the same card', async () => {
    giveCanvasA2dContext();
    let finish: (() => void) | null = null;
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((cb: BlobCallback) => {
      finish = () => cb(new Blob(['png'], { type: 'image/png' }));
    });

    render(<ShareCardButton session={session()} />);
    const button = screen.getByRole('button', { name: /share/i });
    await userEvent.click(button);

    await waitFor(() => expect(button).toBeDisabled());
    finish!();
    await waitFor(() => expect(downloads.calls).toHaveLength(1));
    await waitFor(() => expect(button).toBeEnabled());
  });
});
