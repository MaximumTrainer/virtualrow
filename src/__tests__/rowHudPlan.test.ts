import { describe, it, expect } from 'vitest';
import {
  metricTiles,
  HUD_METRIC_LABEL,
  WIDE_HUD_MIN_PX,
  type HudMetric,
} from '../components/rowHudPlan';

/**
 * Issue #335 — the metrics are on the stage, so how many fit is a decision.
 *
 * Below the stage they could all be shown and the strip simply grew; over it
 * they compete with the river for the same pixels. These cases are the ones
 * the design names: six on a laptop, four on a phone, and the four are the
 * four a rower actually rows to.
 */
describe('which metrics go on the stage', () => {
  it('shows all six on a laptop', () => {
    expect(metricTiles(1280)).toEqual(['split', 'spm', 'power', 'hr', 'distance', 'time']);
  });

  it('drops to four on a phone', () => {
    expect(metricTiles(390)).toEqual(['split', 'spm', 'hr', 'distance']);
  });

  // Stated at the boundary rather than either side of it, because a strip that
  // is one tile too wide does not wrap - it truncates the values, which is the
  // failure this split exists to prevent.
  it('switches at the width the stage stops fitting six', () => {
    expect(metricTiles(WIDE_HUD_MIN_PX)).toHaveLength(6);
    expect(metricTiles(WIDE_HUD_MIN_PX - 1)).toHaveLength(4);
  });

  // The phone list is a subset, not a different screen: a rower who learns the
  // strip on a laptop finds the same tiles saying the same things on a phone.
  it('keeps the phone tiles a subset of the laptop ones, in the same order', () => {
    const wide = metricTiles(1280);
    const narrow = metricTiles(390);

    expect(wide.filter((m) => narrow.includes(m))).toEqual(narrow);
  });

  it('never shows the averages a rower cannot row to', () => {
    // There is no tile for them at any width; they belong to the summary.
    const everyMetric = new Set([...metricTiles(1920), ...metricTiles(320)]);

    expect([...everyMetric].sort()).toEqual(
      ['distance', 'hr', 'power', 'split', 'spm', 'time'] satisfies HudMetric[],
    );
  });

  it('names every metric it can show', () => {
    for (const metric of metricTiles(1280)) {
      expect(HUD_METRIC_LABEL[metric], `${metric} has no label`).toBeTruthy();
    }
  });
});
