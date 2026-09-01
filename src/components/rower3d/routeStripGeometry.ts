import * as THREE from 'three';
import { curveSegmentCount } from './curve';
import { chunkSegmentCount, WHOLE_ROUTE, type ProgressRange } from './geometryChunks';
import type { RouteEnrichmentData } from '../../services/routeEnrichmentService';

// ============================================================================
// Shared frame math for the ribbons that follow a route: the water channel and
// the two riverbanks. Each builder owns its own vertex layout; what they share
// is how a point on the curve becomes a left-hand normal to offset from.
// ============================================================================

export interface StripGeometryOptions {
  enrichment?: RouteEnrichmentData | null;
  /** Slice of the curve to build. Defaults to the whole route. */
  range?: ProgressRange;
}

const UP = new THREE.Vector3(0, 1, 0);
const frameTangent = new THREE.Vector3();

/**
 * Curve point and the left-hand horizontal perpendicular at `t`, written into
 * the caller's vectors.
 *
 * Out-params rather than returns: a 20 km route is built at 800 segments across
 * three strips, and a fresh `Vector3` per sample is thousands of objects the
 * collector has to sweep while the rower waits for the first frame (#224).
 */
export const sampleStripFrame = (
  curve: THREE.CatmullRomCurve3,
  t: number,
  outPoint: THREE.Vector3,
  outPerp: THREE.Vector3,
): void => {
  curve.getPointAt(t, outPoint);
  curve.getTangentAt(t, frameTangent).normalize();
  outPerp.crossVectors(frameTangent, UP).normalize();
};

/** Segments to build across `range`, at the resolution the whole route earns. */
export const stripSegmentCount = (
  curve: THREE.CatmullRomCurve3,
  range: ProgressRange = WHOLE_ROUTE,
): number => chunkSegmentCount(curveSegmentCount(curve), range);

/**
 * Progress of sample `index` within `range`.
 *
 * The last sample returns `range.to` verbatim rather than a lerp that lands
 * near it, so the chunk starting at that boundary samples bit-identical `t` and
 * the two strips meet with no seam.
 */
export const stripProgressAt = (
  range: ProgressRange,
  index: number,
  segments: number,
): number =>
  index >= segments
    ? range.to
    : range.from + (range.to - range.from) * (index / segments);
