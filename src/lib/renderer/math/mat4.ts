/**
 * Hand-rolled 4x4 matrices in column-major order for WebGPU (#542 D1-c).
 *
 * Column-major matches WGSL's `mat4x4<f32>` memory layout, so `writeBuffer`
 * passes the array through with no transpose. The surface is the subset the
 * engine actually calls: identity, perspective, lookAt, multiply, transform.
 */

import type { Vec3 } from './vec3';
import { vec3Cross, vec3Normalize } from './vec3';

export type Mat4 = Float32Array;

export const mat4 = (): Mat4 => {
  const m = new Float32Array(16);
  m[0] = 1;
  m[5] = 1;
  m[10] = 1;
  m[15] = 1;
  return m;
};

export const mat4Identity = (out: Mat4): Mat4 => {
  out.fill(0);
  out[0] = 1;
  out[5] = 1;
  out[10] = 1;
  out[15] = 1;
  return out;
};

export const mat4Copy = (out: Mat4, a: Mat4): Mat4 => {
  out.set(a);
  return out;
};

/**
 * Reverse-Z infinite-far perspective. `fovYRadians` is the vertical FOV; the
 * aspect is width/height. The near plane maps to z=1 and far to z=0, which
 * is the convention WebGPU engines use for better depth precision.
 */
export const mat4Perspective = (
  out: Mat4,
  fovYRadians: number,
  aspect: number,
  near: number,
  far: number,
): Mat4 => {
  const f = 1 / Math.tan(fovYRadians / 2);
  out.fill(0);
  out[0] = f / aspect;
  out[5] = f;
  // Standard (not reverse-Z) depth so a Vitest check reads the same signs as
  // most tutorials; reverse-Z lands as a per-pass tweak when it's needed.
  out[10] = far / (near - far);
  out[11] = -1;
  out[14] = (far * near) / (near - far);
  return out;
};

export const mat4LookAt = (out: Mat4, eye: Vec3, center: Vec3, up: Vec3): Mat4 => {
  const fx = center[0] - eye[0];
  const fy = center[1] - eye[1];
  const fz = center[2] - eye[2];
  const flen = Math.sqrt(fx * fx + fy * fy + fz * fz) || 1;
  const fXn = fx / flen;
  const fYn = fy / flen;
  const fZn = fz / flen;

  const f = new Float32Array([fXn, fYn, fZn]);
  const u = new Float32Array([up[0], up[1], up[2]]);
  const s = new Float32Array(3);
  vec3Cross(s, f, u);
  vec3Normalize(s, s);
  const uTrue = new Float32Array(3);
  vec3Cross(uTrue, s, f);

  out[0] = s[0];
  out[1] = uTrue[0];
  out[2] = -f[0];
  out[3] = 0;

  out[4] = s[1];
  out[5] = uTrue[1];
  out[6] = -f[1];
  out[7] = 0;

  out[8] = s[2];
  out[9] = uTrue[2];
  out[10] = -f[2];
  out[11] = 0;

  out[12] = -(s[0] * eye[0] + s[1] * eye[1] + s[2] * eye[2]);
  out[13] = -(uTrue[0] * eye[0] + uTrue[1] * eye[1] + uTrue[2] * eye[2]);
  out[14] = f[0] * eye[0] + f[1] * eye[1] + f[2] * eye[2];
  out[15] = 1;
  return out;
};

export const mat4Multiply = (out: Mat4, a: Mat4, b: Mat4): Mat4 => {
  const a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3];
  const a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
  const a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11];
  const a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];
  for (let i = 0; i < 4; i++) {
    const b0 = b[i * 4];
    const b1 = b[i * 4 + 1];
    const b2 = b[i * 4 + 2];
    const b3 = b[i * 4 + 3];
    out[i * 4] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
    out[i * 4 + 1] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
    out[i * 4 + 2] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
    out[i * 4 + 3] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;
  }
  return out;
};
