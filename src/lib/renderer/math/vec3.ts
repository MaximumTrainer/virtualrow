/**
 * Hand-rolled 3D vector math for the WebGPU engine (#542 D1-c).
 *
 * `src/lib/renderer/` imports no `three` — the engine owns its own math layer
 * because three's `Vector3` would re-introduce three everywhere it reaches.
 * The surface is deliberately small: just what the engine, camera rig and
 * passes actually need.
 */

export type Vec3 = Float32Array;

export const vec3 = (x = 0, y = 0, z = 0): Vec3 => {
  const v = new Float32Array(3);
  v[0] = x;
  v[1] = y;
  v[2] = z;
  return v;
};

export const vec3Set = (out: Vec3, x: number, y: number, z: number): Vec3 => {
  out[0] = x;
  out[1] = y;
  out[2] = z;
  return out;
};

export const vec3Copy = (out: Vec3, a: Vec3): Vec3 => {
  out[0] = a[0];
  out[1] = a[1];
  out[2] = a[2];
  return out;
};

export const vec3Add = (out: Vec3, a: Vec3, b: Vec3): Vec3 => {
  out[0] = a[0] + b[0];
  out[1] = a[1] + b[1];
  out[2] = a[2] + b[2];
  return out;
};

export const vec3Sub = (out: Vec3, a: Vec3, b: Vec3): Vec3 => {
  out[0] = a[0] - b[0];
  out[1] = a[1] - b[1];
  out[2] = a[2] - b[2];
  return out;
};

export const vec3Scale = (out: Vec3, a: Vec3, s: number): Vec3 => {
  out[0] = a[0] * s;
  out[1] = a[1] * s;
  out[2] = a[2] * s;
  return out;
};

export const vec3Dot = (a: Vec3, b: Vec3): number =>
  a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

export const vec3Cross = (out: Vec3, a: Vec3, b: Vec3): Vec3 => {
  const ax = a[0];
  const ay = a[1];
  const az = a[2];
  const bx = b[0];
  const by = b[1];
  const bz = b[2];
  out[0] = ay * bz - az * by;
  out[1] = az * bx - ax * bz;
  out[2] = ax * by - ay * bx;
  return out;
};

export const vec3LengthSq = (a: Vec3): number =>
  a[0] * a[0] + a[1] * a[1] + a[2] * a[2];

export const vec3Length = (a: Vec3): number => Math.sqrt(vec3LengthSq(a));

export const vec3Normalize = (out: Vec3, a: Vec3): Vec3 => {
  const len = vec3Length(a);
  if (len === 0) {
    out[0] = 0;
    out[1] = 0;
    out[2] = 0;
    return out;
  }
  const inv = 1 / len;
  out[0] = a[0] * inv;
  out[1] = a[1] * inv;
  out[2] = a[2] * inv;
  return out;
};

export const vec3Lerp = (out: Vec3, a: Vec3, b: Vec3, t: number): Vec3 => {
  out[0] = a[0] + (b[0] - a[0]) * t;
  out[1] = a[1] + (b[1] - a[1]) * t;
  out[2] = a[2] + (b[2] - a[2]) * t;
  return out;
};

/**
 * Exponential damping: converges at the same rate in *seconds* at every
 * frame rate. Ported from `cameraRig.ts`'s `damp` without a three dep.
 */
export const vec3Damp = (
  out: Vec3,
  current: Vec3,
  target: Vec3,
  tau: number,
  dt: number,
): Vec3 => {
  if (tau <= 0) return vec3Copy(out, target);
  const t = 1 - Math.exp(-dt / tau);
  return vec3Lerp(out, current, target, t);
};

export const vec3DistanceSq = (a: Vec3, b: Vec3): number => {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  const dz = a[2] - b[2];
  return dx * dx + dy * dy + dz * dz;
};

export const vec3Distance = (a: Vec3, b: Vec3): number =>
  Math.sqrt(vec3DistanceSq(a, b));
