/**
 * Water-strip geometry: a flat ribbon along the route curve, laterally
 * offset to each shore. Ports the shape of
 * `src/components/rower3d/waterGeometry.ts` + `routeStripGeometry.ts` without
 * three. Each sample reads the curve's position and tangent, computes the
 * horizontal perpendicular (tangent × up), and places two vertices at
 * `point ± perp * side`. Side widths come from an optional per-progress
 * function so OSM enrichment can offset the strip asymmetrically; without
 * one, the strip is symmetric at `halfWidth`.
 *
 * With a null curve the strip falls back to a straight +Z ribbon so the
 * smoke pages that mount the engine without a route still have water.
 */

import { RouteCurve } from '../math/curve';
import { vec3, vec3Normalize, type Vec3 } from '../math/vec3';

/** Scene Y of the water surface, matching the React port's constant. */
export const WATER_SURFACE_Y = -0.1;

export interface WaterStripGeometry {
  positions: Float32Array; // interleaved x,y,z
  indices: Uint16Array;
}

/** Width on each side of the centreline at a given progress along the curve. */
export interface WaterEdges {
  left: number;
  right: number;
}

export interface BuildWaterStripOptions {
  /**
   * Per-side width at `progress`. Omitted → symmetric `halfWidth`. Used by
   * the shell to feed `routeEnrichmentService.getWaterEdgesSceneUnitsForProgress`
   * so the strip tracks measured OSM shore distances per segment.
   */
  edgesForProgress?: (progress: number) => WaterEdges;
  halfWidth?: number;
  /** Fallback length when `curve` is null (straight ribbon only). */
  length?: number;
  /** Vertex columns along the strip. ≥2. */
  divisions?: number;
}

const UP: Vec3 = vec3(0, 1, 0);

export const buildWaterStrip = (
  curve: RouteCurve | null,
  options: BuildWaterStripOptions = {},
): WaterStripGeometry => {
  const halfWidth = options.halfWidth ?? 20;
  const length = options.length ?? 400;
  const divisions = Math.max(2, options.divisions ?? 128);
  const edgesForProgress = options.edgesForProgress
    ?? ((_t: number): WaterEdges => ({ left: halfWidth, right: halfWidth }));

  const vertexCount = divisions + 1;
  const positions = new Float32Array(vertexCount * 2 * 3);

  if (curve && curve.length >= 2) {
    const sample = { position: vec3(), tangent: vec3(0, 0, -1), angle: 0 };
    const perp = vec3();
    for (let i = 0; i <= divisions; i += 1) {
      const t = i / divisions;
      curve.sample(t, sample);
      // Left-hand perpendicular = tangent × up, normalised.
      perp[0] = sample.tangent[1] * UP[2] - sample.tangent[2] * UP[1];
      perp[1] = sample.tangent[2] * UP[0] - sample.tangent[0] * UP[2];
      perp[2] = sample.tangent[0] * UP[1] - sample.tangent[1] * UP[0];
      vec3Normalize(perp, perp);
      const { left, right } = edgesForProgress(t);
      const o = i * 6;
      positions[o] = sample.position[0] - perp[0] * left;
      positions[o + 1] = WATER_SURFACE_Y;
      positions[o + 2] = sample.position[2] - perp[2] * left;
      positions[o + 3] = sample.position[0] + perp[0] * right;
      positions[o + 4] = WATER_SURFACE_Y;
      positions[o + 5] = sample.position[2] + perp[2] * right;
    }
  } else {
    // Straight-line fallback for smoke pages without a route.
    for (let i = 0; i <= divisions; i += 1) {
      const t = i / divisions;
      const z = -t * length;
      const { left, right } = edgesForProgress(t);
      const o = i * 6;
      positions[o] = -left;
      positions[o + 1] = WATER_SURFACE_Y;
      positions[o + 2] = z;
      positions[o + 3] = right;
      positions[o + 4] = WATER_SURFACE_Y;
      positions[o + 5] = z;
    }
  }

  // Triangle winding faces the sky (CCW when viewed from +Y). Mirrored
  // against the bank strip's convention — getting this wrong lights the
  // water from below under DoubleSide materials, which was #284.
  // uint16 is enough: 128 divisions × 2 verts × 6 indices = 1536, well under 65 535.
  const indices = new Uint16Array(divisions * 6);
  for (let i = 0; i < divisions; i += 1) {
    const base = i * 2;
    const o = i * 6;
    indices[o] = base;
    indices[o + 1] = base + 1;
    indices[o + 2] = base + 2;
    indices[o + 3] = base + 1;
    indices[o + 4] = base + 3;
    indices[o + 5] = base + 2;
  }

  return { positions, indices };
};
