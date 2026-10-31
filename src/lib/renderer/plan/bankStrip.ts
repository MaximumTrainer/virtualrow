/**
 * Bank-strip geometry. Two ribbons of ground running on either side of the
 * water strip; shares the water's `RouteCurve` so bank and water bend
 * together along the GPS polyline. Before this was curve-aware
 * (#549 slice) the bank was hardcoded to a straight 400 m ±20..±80 ribbon,
 * so a boat following a bending route would appear to drift onto bare
 * terrain whenever the curve turned past where the straight bank reached.
 *
 * Falls back to the old straight ribbon when no curve is supplied (smoke
 * pages that mount the engine without a route).
 */

import type { RouteCurve } from '../math/curve';
import { vec3Normalize, vec3, type Vec3 } from '../math/vec3';
import { WATER_SURFACE_Y, type WaterEdges } from './waterStrip';

export interface BankStripGeometry {
  positions: Float32Array; // x,y,z
  /**
   * Per-vertex (sign, shoreDist) pair. `sign` is ±1 as before (left vs right
   * strip, kept for compatibility). `shoreDist` is metres from the water
   * edge: 0 at the inner (shore-side) row of the strip, `bankWidth` at the
   * outer row. The bank pass's triplanar grass/earth blend (#591-fu P0b)
   * reads it to pick wet earth near the shore and lush grass further in.
   */
  sides: Float32Array;
  indices: Uint16Array;
}

export interface BuildBankStripsOptions {
  curve?: RouteCurve | null;
  /** Default inner edge when no `edgesForProgress` is supplied. */
  waterHalfWidth?: number;
  /** Width of each bank beyond the waterline. */
  bankWidth?: number;
  /** Straight-line length (smoke-page fallback). */
  length?: number;
  /** Vertex columns along the strip. */
  divisions?: number;
  /**
   * Per-progress shore widths (scene units). Bank's inner edge sits at
   * these values; outer edge is `inner + bankWidth`. Omitted → symmetric.
   */
  edgesForProgress?: (progress: number) => WaterEdges;
}

const UP: Vec3 = vec3(0, 1, 0);

export const buildBankStrips = (
  options: BuildBankStripsOptions = {},
): BankStripGeometry => {
  const curve = options.curve ?? null;
  const waterHalfWidth = options.waterHalfWidth ?? 20;
  const bankWidth = options.bankWidth ?? 60;
  const length = options.length ?? 400;
  const defaultDivisions = curve && curve.length >= 2
    ? Math.max(128, Math.min(16000, Math.ceil(curve.approximateLength(64) / 10)))
    : 40;
  const divisions = Math.max(2, options.divisions ?? defaultDivisions);
  const edgesForProgress = options.edgesForProgress
    ?? ((_t: number): WaterEdges => ({ left: waterHalfWidth, right: waterHalfWidth }));

  const vertsPerStrip = (divisions + 1) * 2;
  const positions = new Float32Array(vertsPerStrip * 2 * 3);
  // `sides` now packs TWO floats per vertex (sign, shoreDist). Each strip
  // (2 strips total) has `vertsPerStrip` verts, each needing 2 floats.
  const sides = new Float32Array(vertsPerStrip * 2 * 2);
  const indices = new Uint16Array(divisions * 6 * 2);

  const sampleCurve = (
    i: number,
    out: { x: number; z: number; perpX: number; perpZ: number },
  ): void => {
    const t = i / divisions;
    if (curve && curve.length >= 2) {
      const s = { position: vec3(), tangent: vec3(0, 0, -1), angle: 0 };
      curve.sample(t, s);
      const perp = vec3();
      perp[0] = s.tangent[1] * UP[2] - s.tangent[2] * UP[1];
      perp[1] = s.tangent[2] * UP[0] - s.tangent[0] * UP[2];
      perp[2] = s.tangent[0] * UP[1] - s.tangent[1] * UP[0];
      vec3Normalize(perp, perp);
      out.x = s.position[0];
      out.z = s.position[2];
      out.perpX = perp[0];
      out.perpZ = perp[2];
    } else {
      out.x = 0;
      out.z = -t * length;
      out.perpX = -1; // tangent (+Z) × up = (-1, 0, 0); matches the old straight bank
      out.perpZ = 0;
    }
  };

  const writeStrip = (sign: 1 | -1, vertOffset: number, indexOffset: number): void => {
    const sample = { x: 0, z: 0, perpX: 0, perpZ: 0 };
    for (let i = 0; i <= divisions; i += 1) {
      sampleCurve(i, sample);
      const t = i / divisions;
      const { left, right } = edgesForProgress(t);
      const shore = sign < 0 ? left : right;
      const innerX = sample.x + sample.perpX * sign * shore;
      const innerZ = sample.z + sample.perpZ * sign * shore;
      const outerX = sample.x + sample.perpX * sign * (shore + bankWidth);
      const outerZ = sample.z + sample.perpZ * sign * (shore + bankWidth);
      const vo = (vertOffset + i * 2) * 3;
      positions[vo] = innerX;
      positions[vo + 1] = WATER_SURFACE_Y + 0.1; // bank sits a hair above the water
      positions[vo + 2] = innerZ;
      positions[vo + 3] = outerX;
      positions[vo + 4] = WATER_SURFACE_Y + 0.1;
      positions[vo + 5] = outerZ;
      // `sides` lane layout: 2 floats per vertex → (sign, shoreDistMetres).
      // Inner vertex rides at shoreDist=0; outer vertex at shoreDist=bankWidth.
      // bank.wgsl mixes grass vs earth / wet-shore vs lush-mid off this value.
      const si = (vertOffset + i * 2) * 2;
      sides[si] = sign;
      sides[si + 1] = 0;
      sides[si + 2] = sign;
      sides[si + 3] = bankWidth;
    }
    for (let i = 0; i < divisions; i += 1) {
      const base = vertOffset + i * 2;
      const o = (indexOffset + i) * 6;
      // Wind so the ground faces up on either side (same convention as the
      // pre-curve straight ribbon the old #269 bug uncovered).
      if (sign > 0) {
        indices[o] = base;
        indices[o + 1] = base + 2;
        indices[o + 2] = base + 1;
        indices[o + 3] = base + 1;
        indices[o + 4] = base + 2;
        indices[o + 5] = base + 3;
      } else {
        indices[o] = base;
        indices[o + 1] = base + 1;
        indices[o + 2] = base + 2;
        indices[o + 3] = base + 1;
        indices[o + 4] = base + 3;
        indices[o + 5] = base + 2;
      }
    }
  };

  writeStrip(-1, 0, 0);
  writeStrip(1, vertsPerStrip, divisions);

  return { positions, sides, indices };
};
