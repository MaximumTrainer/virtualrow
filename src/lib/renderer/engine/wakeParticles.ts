/**
 * Hull wake particles (#571 slice: water-wake / foam under the hull).
 *
 * A tiny CPU particle system: spawn a soft white billboard at the boat's
 * stern every ~`spawnIntervalSec`, drift it slowly outward with the
 * boat's wake, scale up and fade to zero over `lifetimeSec`. Rendered as
 * instanced camera-facing quads by `passes/wakeParticles.ts`.
 *
 * The pool is a fixed-size ring buffer so updates and GPU writes are
 * allocation-free each frame. The particle count caps the GPU draw, so a
 * stuck-high spawn rate can only ever waste one frame's slots before the
 * ring overwrites itself.
 *
 * Pure TypeScript — no GPU surface — so the unit tests can exercise
 * spawn, age, fade and world-position maths without a device.
 */

/** How much state each particle carries. The GPU-side storage buffer
 *  reads particles as pairs of `vec4<f32>` (vertex shader indexes
 *  `particles[ii*2]` + `particles[ii*2+1]`), so the stride is 8 floats
 *  / 32 bytes per instance. Layout:
 *    [0..3]  x, y, z, age
 *    [4..7]  lifetime, size, _pad, _pad
 *  Only the first six matter to the CPU logic; the two pads keep the
 *  vec4-aligned storage buffer happy. */
export const WAKE_FLOATS_PER_PARTICLE = 8;

/** Default pool size — enough for ~2 s of wake at 20 Hz spawn (~40 live
 *  particles at a time), with headroom for a larger window if the spawn
 *  rate ticks up. */
export const WAKE_POOL_SIZE_DEFAULT = 128;

/** How long each particle lives (seconds). The ride-view wake fades out
 *  comfortably inside the fog near-plane, so even on a basic tier the
 *  particle disappears before it enters any read-anomalous region. */
export const WAKE_LIFETIME_SEC_DEFAULT = 1.6;

/** Shortest interval between spawns. Each spawn drops two particles —
 *  one for the port side of the stern, one for starboard — so the real
 *  spawn rate is 2 / spawnInterval. */
export const WAKE_SPAWN_INTERVAL_SEC_DEFAULT = 0.08;

/** Lateral offset either side of the stern where particles emerge. */
export const WAKE_HALF_WIDTH_METRES = 0.45;

/** How far behind the boat origin the stern sits (hull is ~8 m long;
 *  origin is at the midship line in the loaded shell GLB). */
export const WAKE_STERN_OFFSET_METRES = -3.4;

/** Pool state. Mutable in place — never recreate per frame. */
export interface WakeState {
  readonly pool: Float32Array;
  readonly size: number;
  readonly lifetimeSec: number;
  readonly spawnIntervalSec: number;
  /** Ring-buffer write cursor (0..size-1). */
  cursor: number;
  /** Seconds remaining before the next spawn. Advances each `updateWake`. */
  secondsUntilNextSpawn: number;
  /** How many particles have ever been spawned (test helper + telemetry). */
  spawnCount: number;
}

export const createWakeState = (
  size = WAKE_POOL_SIZE_DEFAULT,
  lifetimeSec = WAKE_LIFETIME_SEC_DEFAULT,
  spawnIntervalSec = WAKE_SPAWN_INTERVAL_SEC_DEFAULT,
): WakeState => ({
  pool: new Float32Array(size * WAKE_FLOATS_PER_PARTICLE),
  size,
  lifetimeSec,
  spawnIntervalSec,
  cursor: 0,
  // Prime the clock to the full interval so the first `updateWake` with
  // `dt = spawnIntervalSec` fires exactly one spawn (2 particles), not two.
  secondsUntilNextSpawn: spawnIntervalSec,
  spawnCount: 0,
});

/** Advance every particle's `age` by `dt`. Negative dt is clamped to 0. */
const ageAll = (state: WakeState, dt: number): void => {
  const d = dt > 0 ? dt : 0;
  const stride = WAKE_FLOATS_PER_PARTICLE;
  const pool = state.pool;
  for (let i = 0; i < state.size; i += 1) {
    const base = i * stride;
    const lifetime = pool[base + 4];
    if (lifetime <= 0) continue; // never spawned
    pool[base + 3] += d; // age
  }
};

/** Spawn one particle at the given world coord with the given size. */
const spawnOne = (state: WakeState, x: number, y: number, z: number, size: number): void => {
  const base = state.cursor * WAKE_FLOATS_PER_PARTICLE;
  state.pool[base + 0] = x;
  state.pool[base + 1] = y;
  state.pool[base + 2] = z;
  state.pool[base + 3] = 0; // age
  state.pool[base + 4] = state.lifetimeSec;
  state.pool[base + 5] = size;
  state.pool[base + 6] = 0; // pad
  state.pool[base + 7] = 0; // pad
  state.cursor = (state.cursor + 1) % state.size;
  state.spawnCount += 1;
};

/**
 * Run one frame of the wake system. Idle (`isMoving = false`) ages
 * particles but spawns nothing — the trail dies down behind a stationary
 * boat. Call once per frame from the ride loop.
 */
export const updateWake = (
  state: WakeState,
  boatWorldX: number,
  boatWorldY: number,
  boatWorldZ: number,
  boatHeadingRadians: number,
  isMoving: boolean,
  dt: number,
): void => {
  ageAll(state, dt);
  if (!isMoving) return;
  state.secondsUntilNextSpawn -= dt;
  while (state.secondsUntilNextSpawn <= 0) {
    state.secondsUntilNextSpawn += state.spawnIntervalSec;
    // Local-space stern offset: along -Z in boat local, with ±X for port/
    // starboard. World-rotate by the boat's Y heading (same convention as
    // `mat4FromRotationY` — `angle = atan2(tangent.x, tangent.z)`).
    const sinH = Math.sin(boatHeadingRadians);
    const cosH = Math.cos(boatHeadingRadians);
    const localZ = WAKE_STERN_OFFSET_METRES;
    const sternWorldX = boatWorldX + localZ * sinH;
    const sternWorldZ = boatWorldZ + localZ * cosH;
    // Port / starboard offsets rotate with the heading too.
    const portWorldX = sternWorldX + WAKE_HALF_WIDTH_METRES * cosH;
    const portWorldZ = sternWorldZ - WAKE_HALF_WIDTH_METRES * sinH;
    const stbdWorldX = sternWorldX - WAKE_HALF_WIDTH_METRES * cosH;
    const stbdWorldZ = sternWorldZ + WAKE_HALF_WIDTH_METRES * sinH;
    const foamY = boatWorldY - 0.15; // sit the particle just under the hull
    spawnOne(state, portWorldX, foamY, portWorldZ, 0.5);
    spawnOne(state, stbdWorldX, foamY, stbdWorldZ, 0.5);
  }
};

/**
 * How many particles are currently alive (age < lifetime). O(size), used
 * by the GPU pass to shrink the instanced draw and by the tests to
 * check lifecycle.
 */
export const activeWakeCount = (state: WakeState): number => {
  let n = 0;
  const stride = WAKE_FLOATS_PER_PARTICLE;
  for (let i = 0; i < state.size; i += 1) {
    const base = i * stride;
    const lifetime = state.pool[base + 4];
    if (lifetime <= 0) continue;
    if (state.pool[base + 3] < lifetime) n += 1;
  }
  return n;
};
