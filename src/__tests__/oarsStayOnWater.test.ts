import { describe, it, expect } from 'vitest';
import { getWaterWidthSceneUnitsForProgress } from '../services/routeEnrichmentService';
import type { RouteSegmentEnrichment } from '../services/routeEnrichmentService';
import { OAR_REACH_METERS, bladeClearanceMeters } from '../components/rower3d/navigableWidth';
import { SCENE_SCALE } from '../components/rower3d/constants';

/**
 * The blades reach 2.78 m either side of the centreline. The boat sits on the
 * route curve and the channel is built symmetrically about it, so the blades
 * are over water exactly when half the channel exceeds that reach — which
 * nothing checked (#271).
 */
const reachSceneUnits = OAR_REACH_METERS * SCENE_SCALE;

const profiles = (widths: number[]): RouteSegmentEnrichment[] =>
  widths.map((waterWidthMeters, index) =>
    ({
      index,
      startMeters: index * 100,
      endMeters: (index + 1) * 100,
      sceneryProfile: 'fallback',
      waterWidthMeters,
      treeDensity: 0.5,
      vegetationDensity: 0.5,
      buildingDensity: 0.1,
      objectScale: 1,
      dragMultiplier: 1,
      bearing: 0,
      bearingDelta: 0,
    }) as unknown as RouteSegmentEnrichment,
  );

describe('the blades stay over water', () => {
  // The narrowest water a real route reports, read through the same function
  // the frame loop reads it through and handed to the same clearance function
  // (#321). A stream defaults to 7 m, which is narrower than the floor, so what
  // this proves is that the floor is applied and then measured in the units it
  // was applied in - the pair of conversions that used to disagree by ten.
  it('leaves water beyond the blades on a 7 m stream', () => {
    const stream = profiles([7, 7, 7]);

    for (const t of [0, 0.5, 1]) {
      const width = getWaterWidthSceneUnitsForProgress(stream, 7, t);
      expect(
        bladeClearanceMeters(width),
        `blades over the bank at progress ${t}`,
      ).toBeGreaterThanOrEqual(0);
    }
  });

  it('clears the reach on a narrow stream', () => {
    // 3 m of reported water against a 5.56 m span: the case that put the
    // blades on the bank.
    const narrow = profiles([3, 3, 3]);

    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      const half = getWaterWidthSceneUnitsForProgress(narrow, 7, t) / 2;
      expect(half, `blades on land at progress ${t}`).toBeGreaterThan(reachSceneUnits);
    }
  });

  it('clears the reach across a route that narrows and widens', () => {
    // Interpolation between segments is where a floor applied per segment but
    // not to the blend would leak a too-narrow value.
    const varied = profiles([55, 20, 4, 9, 40]);

    for (let i = 0; i <= 40; i += 1) {
      const t = i / 40;
      const half = getWaterWidthSceneUnitsForProgress(varied, 30, t) / 2;
      expect(half, `blades on land at progress ${t.toFixed(3)}`).toBeGreaterThan(reachSceneUnits);
    }
  });

  it('clears the reach with no enrichment at all', () => {
    for (const fallback of [7, 15, 30, 55, 2]) {
      const half = getWaterWidthSceneUnitsForProgress(undefined, fallback, 0.5) / 2;
      expect(half, `blades on land with a ${fallback} m fallback`).toBeGreaterThan(reachSceneUnits);
    }
  });

  it('leaves a genuinely wide river at its reported width', () => {
    // The floor must not quietly widen every river it touches.
    const wide = profiles([55, 55, 55]);

    const width = getWaterWidthSceneUnitsForProgress(wide, 55, 0.5) / SCENE_SCALE;

    expect(width).toBeCloseTo(55, 5);
  });
});
