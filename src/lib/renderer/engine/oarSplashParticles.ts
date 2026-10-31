/**
 * Oar-blade splash particles (#571 slice: oar-blade splash / puddle at
 * catch/finish). Pairs with the hull wake pass — the wake lays down a
 * continuous foam trail behind the stern; this fires a short burst at
 * each blade tip whenever the stroke phase crosses the catch (phase 0)
 * or finish (phase 0.5) boundary. Pure TypeScript state + a GPU-side
 * billboard pass; no CPU work on the GPU, no GPU work on the CPU.
 *
 * Burst detection is a phase-crossing on `strokePhase` (the same
 * sinusoidal driver `characterPlacement.strokePhase` returns). Each
 * burst drops N particles per blade, each with a slight random
 * horizontal spread and a positive initial velocity so the shader can
 * arc them under gravity.
 *
 * Pool layout per particle (8 floats, aligned for `vec4<f32>` reads in
 * WGSL — matches wakeParticles):
 *   [0..3]  x, y, z, age
 *   [4..7]  lifetime, size, vx, vz (vy comes from a shader-side gravity
 *   model so we don't store it; the horizontal velocity is per-particle
 *   so splashes aren't collinear with the boat heading).
 */

export const OAR_SPLASH_FLOATS_PER_PARTICLE = 8;
export const OAR_SPLASH_POOL_SIZE_DEFAULT = 128;
export const OAR_SPLASH_LIFETIME_SEC = 0.6;
export const OAR_SPLASH_BURST_SIZE = 6; // particles per blade per burst
export const OAR_SPLASH_LATERAL_OFFSET_METRES = 2.4; // blade tip offset from hull centreline
export const OAR_SPLASH_HEIGHT_METRES = -0.05; // just below the water line

export interface OarSplashState {
  readonly pool: Float32Array;
  readonly size: number;
  readonly lifetimeSec: number;
  cursor: number;
  /** Last observed stroke phase in [0, 1); used to detect catch (0) and
   *  finish (0.5) crossings between frames. */
  lastPhase: number;
  spawnCount: number;
}

export const createOarSplashState = (
  size = OAR_SPLASH_POOL_SIZE_DEFAULT,
  lifetimeSec = OAR_SPLASH_LIFETIME_SEC,
): OarSplashState => ({
  pool: new Float32Array(size * OAR_SPLASH_FLOATS_PER_PARTICLE),
  size,
  lifetimeSec,
  cursor: 0,
  lastPhase: 0,
  spawnCount: 0,
});

const ageAll = (state: OarSplashState, dt: number): void => {
  const d = dt > 0 ? dt : 0;
  const stride = OAR_SPLASH_FLOATS_PER_PARTICLE;
  const pool = state.pool;
  for (let i = 0; i < state.size; i += 1) {
    const base = i * stride;
    if (pool[base + 4] <= 0) continue;
    pool[base + 3] += d;
  }
};

const spawnOne = (
  state: OarSplashState,
  x: number,
  y: number,
  z: number,
  size: number,
  vx: number,
  vz: number,
): void => {
  const base = state.cursor * OAR_SPLASH_FLOATS_PER_PARTICLE;
  state.pool[base + 0] = x;
  state.pool[base + 1] = y;
  state.pool[base + 2] = z;
  state.pool[base + 3] = 0;
  state.pool[base + 4] = state.lifetimeSec;
  state.pool[base + 5] = size;
  state.pool[base + 6] = vx;
  state.pool[base + 7] = vz;
  state.cursor = (state.cursor + 1) % state.size;
  state.spawnCount += 1;
};

/** True when `prev → curr` crosses the given threshold inside [0, 1). */
const crossedBoundary = (prev: number, curr: number, boundary: number): boolean => {
  // Normal case: forward step across boundary.
  if (prev < boundary && curr >= boundary) return true;
  // Wrap case: prev was > curr (crossed 1→0), check whether boundary
  // sits in the wrap. The boundary we care about either lies in
  // (prev, 1] or in [0, curr]. For 0-boundary any wrap counts.
  if (curr < prev) {
    if (boundary === 0) return true;
    if (boundary > prev || boundary <= curr) return true;
  }
  return false;
};

/**
 * Deterministic hash-driven jitter so adjacent bursts don't collapse
 * into the same stamp. Seeds should include the spawn count so each
 * particle gets its own direction.
 */
const jitter = (seed: number): number => {
  const s = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s); // [0, 1)
};

const burstAt = (
  state: OarSplashState,
  centreX: number,
  centreZ: number,
  perp: { x: number; z: number },
): void => {
  for (let i = 0; i < OAR_SPLASH_BURST_SIZE; i += 1) {
    // Spread particles in a tight patch around the blade tip.
    const seed = state.spawnCount + i * 0.37;
    const offU = (jitter(seed) - 0.5) * 0.6;
    const offV = (jitter(seed + 1) - 0.5) * 0.6;
    const x = centreX + offU;
    const z = centreZ + offV;
    // Lateral velocity: outward from the blade centre, so the plume
    // reads as water flung sideways rather than drifting straight back.
    const vMag = 0.6 + jitter(seed + 2) * 0.6;
    const vx = perp.x * vMag + (jitter(seed + 3) - 0.5) * 0.4;
    const vz = perp.z * vMag + (jitter(seed + 4) - 0.5) * 0.4;
    const size = 0.25 + jitter(seed + 5) * 0.15;
    spawnOne(state, x, OAR_SPLASH_HEIGHT_METRES, z, size, vx, vz);
  }
};

/**
 * Run one frame of the oar-splash sim. Catches both the catch
 * (phase ≈ 0) and the finish (phase ≈ 0.5) via phase-crossing
 * detection, then drops one burst per blade. `isPlaying = false`
 * ages the pool without spawning (the puddle trailing behind the hull
 * dies down when the rower stops).
 */
export const updateOarSplash = (
  state: OarSplashState,
  boatWorldX: number,
  boatWorldZ: number,
  boatHeadingRadians: number,
  strokePhase: number,
  isPlaying: boolean,
  dt: number,
): void => {
  ageAll(state, dt);
  if (!isPlaying) {
    state.lastPhase = strokePhase;
    return;
  }
  const sinH = Math.sin(boatHeadingRadians);
  const cosH = Math.cos(boatHeadingRadians);
  // Local-X in world space (starboard direction after the heading yaw).
  const starboardX = cosH;
  const starboardZ = -sinH;
  const atCatch = crossedBoundary(state.lastPhase, strokePhase, 0);
  const atFinish = crossedBoundary(state.lastPhase, strokePhase, 0.5);
  if (atCatch || atFinish) {
    const port = { x: -starboardX, z: -starboardZ };
    const stbd = { x: starboardX, z: starboardZ };
    const portBladeX = boatWorldX - starboardX * OAR_SPLASH_LATERAL_OFFSET_METRES;
    const portBladeZ = boatWorldZ - starboardZ * OAR_SPLASH_LATERAL_OFFSET_METRES;
    const stbdBladeX = boatWorldX + starboardX * OAR_SPLASH_LATERAL_OFFSET_METRES;
    const stbdBladeZ = boatWorldZ + starboardZ * OAR_SPLASH_LATERAL_OFFSET_METRES;
    burstAt(state, portBladeX, portBladeZ, port);
    burstAt(state, stbdBladeX, stbdBladeZ, stbd);
  }
  state.lastPhase = strokePhase;
};

export const activeOarSplashCount = (state: OarSplashState): number => {
  let n = 0;
  const stride = OAR_SPLASH_FLOATS_PER_PARTICLE;
  for (let i = 0; i < state.size; i += 1) {
    const base = i * stride;
    if (state.pool[base + 4] <= 0) continue;
    if (state.pool[base + 3] < state.pool[base + 4]) n += 1;
  }
  return n;
};
