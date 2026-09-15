import * as THREE from 'three';

// ============================================================================
// Chunking for the strip geometry that follows a route (#224).
//
// The water channel and both riverbanks span the whole course, but the rower
// only ever sees the few hundred scene units around the boat. Splitting the
// strips into contiguous progress bands lets the far ones be built later and
// drawn never — the same windowing the landscape elements already do.
// ============================================================================

/** A contiguous slice of a route curve, in normalised progress. */
export interface ProgressRange {
  from: number;
  to: number;
}

export const WHOLE_ROUTE: ProgressRange = { from: 0, to: 1 };

/** Route metres a single chunk covers, before {@link MAX_GEOMETRY_CHUNKS} bites. */
export const TARGET_METERS_PER_CHUNK = 1500;

/** Ceiling on chunks per strip: past this the draw calls cost more than they save. */
export const MAX_GEOMETRY_CHUNKS = 16;

/**
 * How many pieces to build a route's strip geometry in.
 *
 * Courses shorter than a chunk stay whole — a 2 km sprint is entirely inside
 * the view distance, so splitting it would add draw calls and cull nothing.
 */
export const chunkCountForRoute = (routeLengthMeters: number): number => {
  if (!Number.isFinite(routeLengthMeters) || routeLengthMeters <= 0) return 1;
  const wanted = Math.ceil(routeLengthMeters / TARGET_METERS_PER_CHUNK);
  return Math.max(1, Math.min(MAX_GEOMETRY_CHUNKS, wanted));
};

/**
 * Split the curve into `chunkCount` contiguous progress bands.
 *
 * Neighbouring ranges share a boundary value computed by the same expression,
 * so the two chunks either side of it sample the curve at bit-identical `t` and
 * their edge vertices coincide — no seam in the water.
 */
export const chunkProgressRanges = (chunkCount: number): ProgressRange[] => {
  if (chunkCount <= 1) return [WHOLE_ROUTE];
  return Array.from({ length: chunkCount }, (_, index) => ({
    from: index / chunkCount,
    to: (index + 1) / chunkCount,
  }));
};

/** Segments to spend on one chunk so the strip's resolution stays uniform. */
export const chunkSegmentCount = (
  routeSegments: number,
  { from, to }: ProgressRange,
): number => Math.max(1, Math.round(routeSegments * (to - from)));

/**
 * Scene units past which a strip chunk stops being drawn.
 *
 * The figure was chosen when the scene had fog: `fogExp2` at density 0.0025
 * left about a tenth of a surface visible at 700 units, so the cut was hidden.
 * The fog is gone, and this distance is now justified by geometry alone — the
 * water is near-horizontal and near-edge-on by 700 units, and that is 7 km of
 * route at {@link SCENE_SCALE}, so nothing shorter than a head race culls at
 * all.
 *
 * On a course long enough to reach it, the strip now ends without anything
 * softening the edge. The horizon silhouette is 300 units wide against a 60°
 * field of view, so it covers most of the view ahead but not its margins
 * (issue #232).
 */
export const CHUNK_VIEW_DISTANCE_SCENE_UNITS = 700;

/**
 * Whether a chunk is close enough to the boat to be worth drawing.
 *
 * Measured from the chunk's bounding sphere rather than its progress band: a
 * loop course brings the far end of the route back alongside the boat, and
 * progress distance would hide water the rower is looking straight at.
 */
export const isChunkWithinViewDistance = (
  bounds: THREE.Sphere | null,
  boatPosition: THREE.Vector3,
  viewDistance: number = CHUNK_VIEW_DISTANCE_SCENE_UNITS,
): boolean => {
  if (!bounds) return true;
  return bounds.center.distanceTo(boatPosition) - bounds.radius <= viewDistance;
};
