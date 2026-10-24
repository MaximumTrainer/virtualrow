import { describe, it, expect } from 'vitest';

import { metricTiles, HUD_METRIC_LABEL, WIDE_HUD_MIN_PX } from '../lib/ui/rowHudPlan';

// #542 P1 workout view: which HUD tiles show is a function of the viewport,
// ported verbatim from rowHudPlan.ts.
describe('rowHudPlan.metricTiles', () => {
  it('shows all six tiles at or above the wide threshold', () => {
    expect(metricTiles(WIDE_HUD_MIN_PX)).toEqual(['split', 'spm', 'power', 'hr', 'distance', 'time']);
    expect(metricTiles(1280)).toEqual(['split', 'spm', 'power', 'hr', 'distance', 'time']);
  });

  it('drops power and time to four tiles below the wide threshold', () => {
    expect(metricTiles(WIDE_HUD_MIN_PX - 1)).toEqual(['split', 'spm', 'hr', 'distance']);
    expect(metricTiles(390)).toEqual(['split', 'spm', 'hr', 'distance']);
  });

  it('labels every metric with its unit', () => {
    expect(HUD_METRIC_LABEL).toEqual({
      split: 'Split (/500m)',
      spm: 'SPM',
      power: 'Power (W)',
      hr: 'Heart Rate (bpm)',
      distance: 'Meters',
      time: 'Time',
    });
  });
});
