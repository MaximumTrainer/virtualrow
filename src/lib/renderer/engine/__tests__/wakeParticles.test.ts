import { describe, expect, it } from 'vitest';

import {
  WAKE_FLOATS_PER_PARTICLE,
  WAKE_HALF_WIDTH_METRES,
  WAKE_LIFETIME_SEC_DEFAULT,
  WAKE_POOL_SIZE_DEFAULT,
  WAKE_SPAWN_INTERVAL_SEC_DEFAULT,
  WAKE_STERN_OFFSET_METRES,
  activeWakeCount,
  createWakeState,
  updateWake,
} from '../wakeParticles';

describe('wakeParticles (#571 water-wake slice)', () => {
  it('starts with an empty pool and zero spawns', () => {
    const s = createWakeState();
    expect(s.pool.length).toBe(WAKE_POOL_SIZE_DEFAULT * WAKE_FLOATS_PER_PARTICLE);
    expect(s.cursor).toBe(0);
    expect(s.spawnCount).toBe(0);
    expect(activeWakeCount(s)).toBe(0);
  });

  it('spawns no particles while the boat is still', () => {
    const s = createWakeState();
    for (let i = 0; i < 50; i += 1) {
      updateWake(s, 0, 0, 0, 0, false, 0.016);
    }
    expect(s.spawnCount).toBe(0);
    expect(activeWakeCount(s)).toBe(0);
  });

  it('spawns pairs of particles while moving, roughly at the configured rate', () => {
    const s = createWakeState();
    const dt = WAKE_SPAWN_INTERVAL_SEC_DEFAULT; // one spawn per step
    for (let i = 0; i < 10; i += 1) {
      updateWake(s, 0, 0, 0, 0, true, dt);
    }
    // Each spawn drops two particles (port + starboard). The clock is
    // primed to the full interval, so one pair per step → 2 × 10 = 20.
    expect(s.spawnCount).toBe(20);
    expect(activeWakeCount(s)).toBe(s.spawnCount);
  });

  it('ages particles out of the active window once their lifetime elapses', () => {
    const s = createWakeState();
    updateWake(s, 0, 0, 0, 0, true, WAKE_SPAWN_INTERVAL_SEC_DEFAULT); // 2 spawned
    expect(activeWakeCount(s)).toBe(2);
    // Age past the lifetime without spawning more.
    updateWake(s, 0, 0, 0, 0, false, WAKE_LIFETIME_SEC_DEFAULT + 0.1);
    expect(activeWakeCount(s)).toBe(0);
  });

  it('places the particles behind the stern and offset to port + starboard (heading 0)', () => {
    const s = createWakeState();
    // Heading 0: boat local -Z is world -Z. Stern offset is -3.4 along
    // local -Z → stern world = boat.z + offset. Pair sits ±0.45 along
    // local +X, which is world +X at heading 0.
    updateWake(s, 10, 0.2, 5, 0, true, WAKE_SPAWN_INTERVAL_SEC_DEFAULT);
    const first = s.pool.subarray(0, WAKE_FLOATS_PER_PARTICLE);
    const second = s.pool.subarray(WAKE_FLOATS_PER_PARTICLE, 2 * WAKE_FLOATS_PER_PARTICLE);
    const port = [first[0], first[2]];
    const stbd = [second[0], second[2]];
    const expectedSternZ = 5 + WAKE_STERN_OFFSET_METRES * Math.cos(0);
    const expectedSternX = 10 + WAKE_STERN_OFFSET_METRES * Math.sin(0);
    expect(port[0]).toBeCloseTo(expectedSternX + WAKE_HALF_WIDTH_METRES, 5);
    expect(port[1]).toBeCloseTo(expectedSternZ, 5);
    expect(stbd[0]).toBeCloseTo(expectedSternX - WAKE_HALF_WIDTH_METRES, 5);
    expect(stbd[1]).toBeCloseTo(expectedSternZ, 5);
  });

  it('rotates stern + lateral offsets with the heading', () => {
    const s = createWakeState();
    // 90° heading rotates boat-local -Z onto world -X. Stern lands at
    // (-stern, _, 0) relative to the boat; port/starboard offsets flip
    // to world ±Z.
    updateWake(s, 0, 0.2, 0, Math.PI / 2, true, WAKE_SPAWN_INTERVAL_SEC_DEFAULT);
    const first = s.pool.subarray(0, WAKE_FLOATS_PER_PARTICLE);
    expect(first[0]).toBeCloseTo(WAKE_STERN_OFFSET_METRES, 5);
    expect(first[2]).toBeCloseTo(-WAKE_HALF_WIDTH_METRES, 5);
  });

  it('ring-wraps rather than overflowing the pool', () => {
    const s = createWakeState(4); // tiny pool
    // Push many spawns through — never allowed to overwrite the Float32Array.
    for (let i = 0; i < 100; i += 1) {
      updateWake(s, 0, 0, 0, 0, true, WAKE_SPAWN_INTERVAL_SEC_DEFAULT);
    }
    expect(s.pool.length).toBe(4 * WAKE_FLOATS_PER_PARTICLE);
    // cursor stays within 0..size-1
    expect(s.cursor).toBeGreaterThanOrEqual(0);
    expect(s.cursor).toBeLessThan(4);
  });

  it('tolerates dt=0 and negative dt without NaN or stale spawns', () => {
    const s = createWakeState();
    updateWake(s, 0, 0, 0, 0, true, WAKE_SPAWN_INTERVAL_SEC_DEFAULT); // get 2 alive
    const beforeAge = s.pool[3];
    updateWake(s, 0, 0, 0, 0, true, 0);
    expect(s.pool[3]).toBe(beforeAge);
    updateWake(s, 0, 0, 0, 0, true, -0.5);
    expect(Number.isFinite(s.pool[3])).toBe(true);
    expect(s.pool[3]).toBe(beforeAge);
  });
});
