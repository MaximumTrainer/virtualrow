/**
 * Minimal quaternion math (#542 D1-c). Used by the camera rig for look-at
 * blending; the engine does the rest in matrices.
 */

export type Quat = Float32Array;

export const quat = (x = 0, y = 0, z = 0, w = 1): Quat => {
  const q = new Float32Array(4);
  q[0] = x;
  q[1] = y;
  q[2] = z;
  q[3] = w;
  return q;
};

export const quatIdentity = (out: Quat): Quat => {
  out[0] = 0;
  out[1] = 0;
  out[2] = 0;
  out[3] = 1;
  return out;
};

export const quatFromAxisAngle = (out: Quat, ax: number, ay: number, az: number, radians: number): Quat => {
  const half = radians / 2;
  const s = Math.sin(half);
  out[0] = ax * s;
  out[1] = ay * s;
  out[2] = az * s;
  out[3] = Math.cos(half);
  return out;
};

export const quatNormalize = (out: Quat, q: Quat): Quat => {
  const len = Math.sqrt(q[0] * q[0] + q[1] * q[1] + q[2] * q[2] + q[3] * q[3]);
  if (len === 0) return quatIdentity(out);
  const inv = 1 / len;
  out[0] = q[0] * inv;
  out[1] = q[1] * inv;
  out[2] = q[2] * inv;
  out[3] = q[3] * inv;
  return out;
};
