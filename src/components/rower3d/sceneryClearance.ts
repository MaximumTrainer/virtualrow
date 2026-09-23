// ============================================================================
// SCENERY CLEARANCE — where the water ends, and how far past it the scenery
// has to stand (#379).
//
// Every lateral offset in the scenery system was an absolute distance from the
// route centreline, authored against a narrow channel, and not one of them
// asked how wide the water was. On a 55 m river the half-width is 27.5 m, so a
// landmark at 7 m stood 20.5 m inside the water and the whole bank-edge band
// was afloat. The water, both banks and the debug guides already read the
// width per point along the route; this is the scenery reading the same one.
// ============================================================================
import * as THREE from 'three';
import { SCENE_SCALE, WATER_CHANNEL_WIDTH, isTelemetryPublished } from './constants';
import {
  getWaterWidthSceneUnitsForProgress,
  type RouteEnrichmentData,
} from '../../services/routeEnrichmentService';

/**
 * Metres past the waterline that anything standing on the bank keeps clear.
 *
 * At least the shoreline strip (1.2 m, `SHORELINE_WIDTH_METRES`), 0.8 m of
 * which is foam drawn up the bank: a placement nearer than that has its
 * footings in the surf. Two metres puts the nearest one past the foam with
 * some grass between.
 */
export const SCENERY_WATER_MARGIN_METRES = 2;

/**
 * Half the water's width at `progress`, in scene units.
 *
 * The same function and the same fallback the water channel is built from, so
 * a route with no enrichment gets the default 20 m channel here as it does
 * there, and the navigable floor applies to both.
 */
export const waterHalfWidthAt = (
  enrichment: RouteEnrichmentData | null | undefined,
  progress: number,
): number =>
  getWaterWidthSceneUnitsForProgress(
    enrichment?.segmentProfiles,
    enrichment?.waterWidthMeters ?? WATER_CHANNEL_WIDTH / SCENE_SCALE,
    progress,
  ) / 2;

/** The nearest to the centreline anything on the bank may stand. */
export const nearestBankOffset = (halfWidth: number): number =>
  halfWidth + SCENERY_WATER_MARGIN_METRES;

/** Anything placed beside the route: where it is, and how far along. */
export interface Standing {
  position: readonly [number, number, number];
  progress: number;
}

export interface ClearanceReading {
  /** Metres from the waterline to the nearest placement; negative is in the water, NaN is nothing measured. */
  nearestM: number;
  /** How many placements were measured. */
  count: number;
  /** Where along the route the nearest one is. */
  progress: number;
}

const UP = new THREE.Vector3(0, 1, 0);

/**
 * How far past the waterline the nearest of `placements` stands.
 *
 * Measured across the route rather than as a straight-line distance to the
 * curve point, because a placement's point and its progress can disagree
 * along the route (the scatter samples 0.999 when its progress says 1) and
 * that difference is not clearance.
 */
export const landClearance = (
  placements: readonly Standing[],
  curve: THREE.Curve<THREE.Vector3>,
  enrichment: RouteEnrichmentData | null | undefined,
): ClearanceReading =>
  placements.reduce<ClearanceReading>(
    (nearest, { position, progress }) => {
      const t = Math.max(0, Math.min(1, progress));
      const centre = curve.getPointAt(t);
      const perp = new THREE.Vector3().crossVectors(curve.getTangentAt(t).normalize(), UP).normalize();
      const across = Math.abs((position[0] - centre.x) * perp.x + (position[2] - centre.z) * perp.z);
      const clearance = across - waterHalfWidthAt(enrichment, progress);
      const count = nearest.count + 1;
      return Number.isNaN(nearest.nearestM) || clearance < nearest.nearestM
        ? { nearestM: clearance, count, progress }
        : { ...nearest, count };
    },
    { nearestM: Number.NaN, count: 0, progress: 0 },
  );

/**
 * Publish a placement path's clearance for an E2E to read (#379).
 *
 * Each path — the GLB scatter, the pinned structures, the procedural
 * landscape — files its own reading, so a failure names the one that put
 * something in the river.
 */
export const publishSceneryClearance = (key: string, reading: ClearanceReading): void => {
  if (!isTelemetryPublished()) return;
  window.__ROWER3D_SCENERY_CLEARANCE = {
    ...window.__ROWER3D_SCENERY_CLEARANCE,
    [key]: { ...reading, marginM: SCENERY_WATER_MARGIN_METRES },
  };
};
