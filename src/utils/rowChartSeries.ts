import type { ActivitySample } from '../types/index';

/**
 * The shape of a row, over the distance it was rowed (#337).
 *
 * The summary reported totals, so a rower could see that they averaged 2:05
 * without seeing that they opened at 1:55 and paid for it. The chart is a
 * `<Line>` over these series; every decision about what it draws is made here
 * so it can be tested without a canvas.
 */

/**
 * Points the chart will draw.
 *
 * A 42 km row at 1 Hz is tens of thousands of samples on a canvas a few
 * hundred pixels wide, so past a few hundred points the extra ones land on
 * pixels that are already drawn and cost only frame time.
 */
export const MAX_CHART_POINTS = 240;

export interface RowChartSeries {
  /** Cumulative metres at each plotted point — the x axis. */
  metres: number[];
  /** Seconds per 500 m, null where the row recorded none. */
  pace: (number | null)[];
  /** Beats per minute, null where the row recorded none. */
  hr: (number | null)[];
}

/**
 * A reading the row never took is null, not zero.
 *
 * Chart.js draws null as a break in the line, which is what a gap in the
 * recording is. Zero would draw a heart rate of zero — a rower who stopped
 * having one — and, on the reversed pace axis, a pace of zero spikes off the
 * top as though they had gone infinitely fast. The monitor reports 0 between
 * strokes, so this is the common case, not the corrupt one.
 */
const reading = (value: number | undefined): number | null =>
  value === undefined || value <= 0 ? null : value;

export const rowChartSeries = (samples: ActivitySample[]): RowChartSeries => {
  const empty: RowChartSeries = { metres: [], pace: [], hr: [] };
  if (samples.length === 0) return empty;

  // A row that never moved has no distance to plot against. Drawing it would
  // stack every sample on x = 0.
  const furthest = samples[samples.length - 1].distance;
  if (!(furthest > 0)) return empty;

  // Thinned, not truncated: taking the last N points would draw the end of the
  // row and label it the row.
  const stride = Math.ceil(samples.length / MAX_CHART_POINTS);

  const kept: ActivitySample[] = [];
  for (let i = 0; i < samples.length; i += stride) kept.push(samples[i]);
  // The last sample is where the row finished, whatever the stride landed on.
  if (kept[kept.length - 1] !== samples[samples.length - 1]) {
    kept.push(samples[samples.length - 1]);
  }

  return {
    metres: kept.map((s) => Math.round(s.distance)),
    pace: kept.map((s) => reading(s.pace)),
    hr: kept.map((s) => reading(s.heartRate)),
  };
};
