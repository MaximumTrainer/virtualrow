/**
 * Six planes extracted from a view-projection matrix, in Hessian normal form
 * (A, B, C, D with Ax + By + Cz + D >= 0 inside the frustum). The engine
 * uses this to CPU-cull against passes until P3's GPU cull lands.
 */

import type { Mat4 } from './mat4';

export type FrustumPlanes = Float32Array; // 6 * 4 = 24 floats

export const frustum = (): FrustumPlanes => new Float32Array(24);

export const extractFrustum = (out: FrustumPlanes, viewProj: Mat4): FrustumPlanes => {
  const m = viewProj;
  const setPlane = (i: number, a: number, b: number, c: number, d: number): void => {
    const invLen = 1 / Math.sqrt(a * a + b * b + c * c) || 1;
    out[i * 4] = a * invLen;
    out[i * 4 + 1] = b * invLen;
    out[i * 4 + 2] = c * invLen;
    out[i * 4 + 3] = d * invLen;
  };
  // Row = column of column-major m: left/right/bottom/top/near/far.
  setPlane(0, m[3] + m[0], m[7] + m[4], m[11] + m[8], m[15] + m[12]);
  setPlane(1, m[3] - m[0], m[7] - m[4], m[11] - m[8], m[15] - m[12]);
  setPlane(2, m[3] + m[1], m[7] + m[5], m[11] + m[9], m[15] + m[13]);
  setPlane(3, m[3] - m[1], m[7] - m[5], m[11] - m[9], m[15] - m[13]);
  setPlane(4, m[3] + m[2], m[7] + m[6], m[11] + m[10], m[15] + m[14]);
  setPlane(5, m[3] - m[2], m[7] - m[6], m[11] - m[10], m[15] - m[14]);
  return out;
};

export const sphereInFrustum = (
  planes: FrustumPlanes,
  cx: number,
  cy: number,
  cz: number,
  radius: number,
): boolean => {
  for (let i = 0; i < 6; i++) {
    const a = planes[i * 4];
    const b = planes[i * 4 + 1];
    const c = planes[i * 4 + 2];
    const d = planes[i * 4 + 3];
    if (a * cx + b * cy + c * cz + d < -radius) return false;
  }
  return true;
};
