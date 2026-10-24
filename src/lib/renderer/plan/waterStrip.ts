/**
 * Minimal water-strip geometry for P2 (#550 FR6). The three version in
 * `src/components/rower3d/waterGeometry.ts` samples the full `CatmullRomCurve3`
 * and extends the strip to the open-water tiles from #493; this port draws a
 * straight-line strip aligned with +Z so the smoke page has water to light.
 *
 * Later phases replace this with the real curve-aligned strip.
 */

import type { RouteCurve } from '../math/curve';
import { vec3 } from '../math/vec3';

export interface WaterStripGeometry {
  positions: Float32Array; // interleaved x,y,z
  indices: Uint16Array;
}

export const buildWaterStrip = (
  _curve: RouteCurve | null,
  options: { halfWidth?: number; length?: number; divisions?: number } = {},
): WaterStripGeometry => {
  const halfWidth = options.halfWidth ?? 20;
  const length = options.length ?? 400;
  const divisions = options.divisions ?? 40;

  const positions = new Float32Array((divisions + 1) * 2 * 3);
  for (let i = 0; i <= divisions; i++) {
    const t = i / divisions;
    const z = -t * length;
    const left = vec3(-halfWidth, 0, z);
    const right = vec3(halfWidth, 0, z);
    const o = i * 6;
    positions[o] = left[0];
    positions[o + 1] = left[1];
    positions[o + 2] = left[2];
    positions[o + 3] = right[0];
    positions[o + 4] = right[1];
    positions[o + 5] = right[2];
  }

  const indices = new Uint16Array(divisions * 6);
  for (let i = 0; i < divisions; i++) {
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
