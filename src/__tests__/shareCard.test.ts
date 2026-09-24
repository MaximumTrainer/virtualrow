import { describe, it, expect, vi } from 'vitest';
import {
  shareCardContent,
  drawShareCard,
  shareCardBlob,
  shareCardFileName,
  SHARE_CARD_WIDTH,
  SHARE_CARD_HEIGHT,
} from '../utils/shareCard';
import type { WorkoutSession } from '../types/index';

/**
 * Issue #337 — the row as a picture somebody can post.
 *
 * Drawn here rather than sent anywhere: a rower sharing their morning row
 * should not have to upload it to a third party to get an image of it back.
 */

const session = (over: Partial<WorkoutSession> = {}): WorkoutSession =>
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
    ...over,
  }) as WorkoutSession;

/** A canvas context that remembers what it was told to draw. */
const recordingContext = () => {
  const text: { value: string; x: number; y: number }[] = [];
  const ctx = {
    canvas: { width: SHARE_CARD_WIDTH, height: SHARE_CARD_HEIGHT },
    fillStyle: '',
    strokeStyle: '',
    font: '',
    textAlign: 'left',
    textBaseline: 'alphabetic',
    lineWidth: 1,
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    createLinearGradient: () => ({ addColorStop: vi.fn() }),
    measureText: (s: string) => ({ width: s.length * 10 }),
    fillText: (value: string, x: number, y: number) => text.push({ value, x, y }),
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, text };
};

describe('the share card’s content', () => {
  it('leads with the route and what was rowed on it', () => {
    const content = shareCardContent(session());

    expect(content.route).toBe('Willowbrook River');
    expect(content.distance).toBe('5.00 km');
    expect(content.time).toBe('21:14');
    expect(content.pace).toBe('2:07/500m');
  });

  // The card is a boast, not a data dump: a field with no reading behind it
  // would post a blank or a zero.
  it('leaves out the readings the row never took', () => {
    const labels = shareCardContent(session()).stats.map((s) => s.label);

    expect(labels).not.toContain('Avg HR');
  });

  it('carries the readings the row did take', () => {
    const content = shareCardContent(session({ heartRateAvg: 148 }));

    expect(content.stats).toContainEqual({ label: 'Avg HR', value: '148 bpm' });
  });

  it('dates the row, so a card found later still says when', () => {
    expect(shareCardContent(session()).date).toMatch(/2026/);
  });
  it('averages the rate and the power the row recorded', () => {
    const samples = Array.from({ length: 60 }, (_, t) => ({
      t,
      distance: t * 4,
      cadence: 24,
      power: 180,
      heartRate: 152,
    }));

    const content = shareCardContent(session({ samples }));

    expect(content.stats).toContainEqual({ label: 'Avg rate', value: '24 spm' });
    expect(content.stats).toContainEqual({ label: 'Avg power', value: '180 W' });
    // Taken from the samples when the session never persisted an average.
    expect(content.stats).toContainEqual({ label: 'Avg HR', value: '152 bpm' });
  });

  // An hour is where a rowed time stops being m:ss, and a card that printed
  // "74:03" would be the only clock in the app that does.
  it('counts the hours on a long row', () => {
    expect(shareCardContent(session({ duration: 4443 })).time).toBe('1:14:03');
  });
});

describe('drawing the share card', () => {
  it('writes every number it was given onto the card', () => {
    const { ctx, text } = recordingContext();
    const content = shareCardContent(session({ heartRateAvg: 148 }));

    drawShareCard(ctx, content);

    const drawn = text.map((t) => t.value);
    expect(drawn).toContain('Willowbrook River');
    expect(drawn).toContain('5.00 km');
    expect(drawn).toContain('21:14');
    expect(drawn).toContain('2:07/500m');
    expect(drawn.join(' ')).toContain('148 bpm');
  });

  // A link preview crops to the card, not the other way round: anything drawn
  // outside these bounds is simply not in the image that gets posted.
  it('keeps everything it draws inside the card', () => {
    const { ctx, text } = recordingContext();

    drawShareCard(ctx, shareCardContent(session({ heartRateAvg: 148 })));

    expect(text.length).toBeGreaterThan(0);
    for (const { value, x, y } of text) {
      expect(y, `"${value}" sits outside the card`).toBeGreaterThan(0);
      expect(y, `"${value}" sits outside the card`).toBeLessThan(SHARE_CARD_HEIGHT);
      expect(x, `"${value}" sits outside the card`).toBeGreaterThanOrEqual(0);
      expect(x, `"${value}" sits outside the card`).toBeLessThanOrEqual(SHARE_CARD_WIDTH);
    }
  });

  it('paints a background, so the card is never transparent', () => {
    const { ctx } = recordingContext();

    drawShareCard(ctx, shareCardContent(session()));

    expect(ctx.fillRect).toHaveBeenCalledWith(0, 0, SHARE_CARD_WIDTH, SHARE_CARD_HEIGHT);
  });
});

describe('the share card as a file', () => {
  const stubCanvas = (toBlob: HTMLCanvasElement['toBlob'], context: CanvasRenderingContext2D | null) => {
    const canvas = document.createElement('canvas');
    canvas.getContext = (() => context) as HTMLCanvasElement['getContext'];
    canvas.toBlob = toBlob;
    vi.spyOn(document, 'createElement').mockImplementationOnce(() => canvas);
    return canvas;
  };

  it('is a 1200x630 PNG, the size a link preview crops to', async () => {
    const { ctx } = recordingContext();
    const canvas = stubCanvas(((cb: BlobCallback, type?: string) =>
      cb(new Blob(['png'], { type }))) as HTMLCanvasElement['toBlob'], ctx);

    const blob = await shareCardBlob(session());

    expect(canvas.width).toBe(SHARE_CARD_WIDTH);
    expect(canvas.height).toBe(SHARE_CARD_HEIGHT);
    expect(blob.type).toBe('image/png');
  });

  /**
   * A browser that cannot give a 2D context cannot make the card.
   *
   * Saying so lets the summary tell the rower their row is safe and only the
   * picture failed; swallowing it would download a zero-byte file instead.
   */
  it('fails out loud when the browser cannot draw', async () => {
    stubCanvas((() => {}) as HTMLCanvasElement['toBlob'], null);

    await expect(shareCardBlob(session())).rejects.toThrow(/could not/i);
  });

  it('fails out loud when the canvas hands back nothing', async () => {
    const { ctx } = recordingContext();
    stubCanvas(((cb: BlobCallback) => cb(null)) as HTMLCanvasElement['toBlob'], ctx);

    await expect(shareCardBlob(session())).rejects.toThrow(/could not/i);
  });

  it('names the file after the route and the day it was rowed', () => {
    expect(shareCardFileName(session())).toBe('virtualrow-willowbrook-river-2026-09-24.png');
  });
});
