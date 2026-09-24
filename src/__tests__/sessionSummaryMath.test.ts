import { describe, it, expect, vi } from 'vitest';
import type { ActivitySample, WorkoutSession } from '../types/index';
import {
  bestPaceOnRoute,
  chartSeries,
  drawShareCard,
  formatPbDelta,
  pbDelta,
  shareCardLines,
  splitsFrom,
  SHARE_CARD_SIZE,
} from '../utils/sessionSummary';

/**
 * Issue #337 — the arithmetic of the post-row summary.
 */

/** A 1 Hz row of 2 000 m, a little faster in the second half. */
const twoKm = (): ActivitySample[] => {
  const samples: ActivitySample[] = [];
  let distance = 0;
  for (let t = 0; distance < 2000; t++) {
    samples.push({ t, distance, pace: 120, power: 180, cadence: t < 250 ? 24 : 28, heartRate: 140 + Math.floor(t / 60) });
    distance = Math.min(2000, distance + (t < 250 ? 4 : 4.2));
  }
  samples.push({ t: samples.length, distance: 2000, pace: 120, power: 180, cadence: 28, heartRate: 150 });
  return samples;
};

const session = (overrides: Partial<WorkoutSession> = {}): WorkoutSession => ({
  id: 's-now',
  routeId: 'r1',
  routeName: 'Willowbrook River',
  startTime: new Date('2026-03-14T08:00:00Z'),
  duration: 492,
  distance: 2000,
  averagePace: 123,
  calories: 100,
  splits: [],
  isActive: false,
  samples: [],
  ...overrides,
});

describe('splitsFrom', () => {
  it('cuts a 2 000 m row into four 500 m splits whose times add up to the row', () => {
    const samples = twoKm();
    const splits = splitsFrom(samples);

    expect(splits.map((s) => s.meters)).toEqual([500, 1000, 1500, 2000]);
    const total = splits.reduce((sum, s) => sum + s.seconds, 0);
    expect(Math.abs(total - samples[samples.length - 1].t)).toBeLessThanOrEqual(1);
  });

  it('gives each split its pace per 500 m and the averages rowed inside it', () => {
    const [first, , , last] = splitsFrom(twoKm());
    expect(first.paceSPer500).toBeCloseTo(125, 0);
    expect(first.spm).toBe(24);
    expect(last.spm).toBe(28);
    expect(last.paceSPer500).toBeLessThan(first.paceSPer500);
    expect(first.watts).toBe(180);
    expect(first.hr).toBeGreaterThanOrEqual(140);
  });

  it('keeps the part-split a row ends on, measured as the part it is', () => {
    const samples = twoKm().filter((s) => s.distance <= 1700);
    const splits = splitsFrom(samples);
    const last = splits[splits.length - 1];
    const ended = samples[samples.length - 1].distance;
    expect(splits).toHaveLength(4);
    expect(last.meters).toBe(ended);
    expect(last.length).toBeCloseTo(ended - 1500, 9);
    // Pace is still per 500 m, not per the 200 m rowed.
    expect(last.paceSPer500).toBeGreaterThan(100);
  });

  it('reports a metric no sample carried as missing, not zero', () => {
    const samples = twoKm().map(({ t, distance }) => ({ t, distance }));
    const [first] = splitsFrom(samples);
    expect(first).toMatchObject({ spm: null, watts: null, hr: null });
  });

  it('has nothing to split in a row that recorded nothing', () => {
    expect(splitsFrom([])).toEqual([]);
    expect(splitsFrom([{ t: 0, distance: 0 }])).toEqual([]);
  });
});

describe('pbDelta', () => {
  it('is negative when today was faster', () => {
    expect(pbDelta(123, 125)).toBe(-2);
    expect(pbDelta(127, 125)).toBe(2);
  });

  it('has no delta on a first row', () => {
    expect(pbDelta(123, null)).toBeNull();
  });

  it('writes the delta the way a rower reads it', () => {
    expect(formatPbDelta(-2)).toBe('−0:02');
    expect(formatPbDelta(3.4)).toBe('+0:03');
    expect(formatPbDelta(0)).toBe('±0:00');
    expect(formatPbDelta(-65)).toBe('−1:05');
  });
});

describe('bestPaceOnRoute', () => {
  const history = [
    session({ id: 'a', averagePace: 125 }),
    session({ id: 'b', averagePace: 121 }),
    session({ id: 'c', routeId: 'elsewhere', averagePace: 110 }),
    session({ id: 'd', averagePace: 0 }),
  ];

  it('is the fastest average split this athlete has rowed on this route before', () => {
    expect(bestPaceOnRoute(history, session())).toBe(121);
  });

  it('does not count the row it is comparing', () => {
    expect(bestPaceOnRoute([session({ averagePace: 100 })], session())).toBeNull();
  });

  it('is null on a route rowed for the first time', () => {
    expect(bestPaceOnRoute(history, session({ routeId: 'new' }))).toBeNull();
  });
});

describe('chartSeries', () => {
  it('plots pace and heart rate against distance in km', () => {
    const series = chartSeries(twoKm());
    expect(series.km[0]).toBe(0);
    expect(series.km[series.km.length - 1]).toBe(2);
    expect(series.pace.length).toBe(series.km.length);
    expect(series.hr.length).toBe(series.km.length);
  });

  it('thins a long row to a chart a phone can draw', () => {
    const long: ActivitySample[] = Array.from({ length: 7200 }, (_, t) => ({ t, distance: t * 4, pace: 125 }));
    expect(chartSeries(long).km.length).toBeLessThanOrEqual(200);
  });
});

describe('the share card', () => {
  it('says the route, the distance, the time and the average split', () => {
    expect(shareCardLines(session())).toEqual({
      title: 'Willowbrook River',
      headline: '2 000 m in 8:12',
      detail: '2:03/500m average',
    });
  });

  it('draws them on a 1200 × 630 card', () => {
    const fillText = vi.fn();
    const ctx = {
      fillRect: vi.fn(),
      fillText,
      createLinearGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
      measureText: vi.fn(() => ({ width: 100 })),
    } as unknown as CanvasRenderingContext2D;

    drawShareCard(ctx, shareCardLines(session()));

    expect(SHARE_CARD_SIZE).toEqual({ width: 1200, height: 630 });
    const drawn = fillText.mock.calls.map((c) => c[0]);
    expect(drawn).toEqual(expect.arrayContaining(['Willowbrook River', '2 000 m in 8:12', '2:03/500m average']));
  });
});
