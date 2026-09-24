import { describe, it, expect } from 'vitest';
import { rowChartSeries, MAX_CHART_POINTS } from '../utils/rowChartSeries';
import type { ActivitySample } from '../types/index';

/**
 * Issue #337 — the shape of the row, over the distance it was rowed.
 *
 * Everything the chart draws is decided here, so the decisions can be tested
 * without a canvas: which samples survive the thinning, what a missing reading
 * becomes, and what the axis is. The component is then a `<Line>` and a set of
 * options.
 */

const row = (metres: number, over: (t: number) => Partial<ActivitySample> = () => ({})) =>
  Array.from({ length: metres / 10 + 1 }, (_, i) => ({
    t: i,
    distance: i * 10,
    pace: 120,
    heartRate: 150,
    ...over(i),
  })) as ActivitySample[];

describe('the row chart’s series', () => {
  it('plots against the distance rowed, not the clock', () => {
    const series = rowChartSeries(row(1000));

    expect(series.metres[0]).toBe(0);
    expect(series.metres[series.metres.length - 1]).toBe(1000);
  });

  it('carries a pace and a heart rate for every point it plots', () => {
    const series = rowChartSeries(row(1000));

    expect(series.pace).toHaveLength(series.metres.length);
    expect(series.hr).toHaveLength(series.metres.length);
  });

  /**
   * A long row is thinned, not truncated.
   *
   * Chart.js draws every point it is given, and a 42 km row at 1 Hz is tens of
   * thousands of them on a canvas a few hundred pixels wide. Taking the last N
   * would draw the end of the row and call it the row.
   */
  it('thins a long row across its whole length', () => {
    const series = rowChartSeries(row(40_000));

    expect(series.metres.length).toBeLessThanOrEqual(MAX_CHART_POINTS);
    expect(series.metres[0]).toBe(0);
    expect(series.metres[series.metres.length - 1]).toBe(40_000);
  });

  it('leaves a short row alone', () => {
    const samples = row(500);

    expect(rowChartSeries(samples).metres).toHaveLength(samples.length);
  });

  /**
   * A gap is a gap, not a zero.
   *
   * Chart.js draws null as a break in the line. Substituting 0 would draw a
   * heart rate of zero, which reads as a rower who stopped having one.
   */
  it('breaks the line where the row recorded nothing', () => {
    const patchy = row(100, (i) => (i > 5 ? { heartRate: undefined } : {}));

    const series = rowChartSeries(patchy);

    expect(series.hr.slice(-3).every((v) => v === null)).toBe(true);
    expect(series.hr[0]).toBe(150);
  });

  // A pace of zero is what the monitor reports between strokes, not a rower
  // travelling infinitely fast. On a reversed axis it would spike off the top.
  it('treats a pace of zero as no reading', () => {
    const stalled = row(100, (i) => (i > 5 ? { pace: 0 } : {}));

    expect(rowChartSeries(stalled).pace.slice(-3).every((v) => v === null)).toBe(true);
  });

  it('has nothing to draw for a row with no samples', () => {
    expect(rowChartSeries([])).toEqual({ metres: [], pace: [], hr: [] });
  });

  it('draws nothing for a row that never moved', () => {
    const still = Array.from({ length: 30 }, (_, t) => ({ t, distance: 0 })) as ActivitySample[];

    expect(rowChartSeries(still).metres).toEqual([]);
  });
});
