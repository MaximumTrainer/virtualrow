import { describe, expect, it } from 'vitest';

import {
  OAR_SPLASH_BURST_SIZE,
  OAR_SPLASH_FLOATS_PER_PARTICLE,
  OAR_SPLASH_LATERAL_OFFSET_METRES,
  OAR_SPLASH_LIFETIME_SEC,
  OAR_SPLASH_POOL_SIZE_DEFAULT,
  activeOarSplashCount,
  createOarSplashState,
  updateOarSplash,
} from '../oarSplashParticles';

describe('oarSplashParticles (#571 slice)', () => {
  it('starts with an empty pool and zero spawns', () => {
    const s = createOarSplashState();
    expect(s.pool.length).toBe(OAR_SPLASH_POOL_SIZE_DEFAULT * OAR_SPLASH_FLOATS_PER_PARTICLE);
    expect(s.cursor).toBe(0);
    expect(s.spawnCount).toBe(0);
    expect(activeOarSplashCount(s)).toBe(0);
  });

  it('spawns nothing while the boat is still', () => {
    const s = createOarSplashState();
    // Phase advances but isPlaying false — no bursts.
    for (let p = 0; p < 1; p += 0.1) {
      updateOarSplash(s, 0, 0, 0, p, false, 0.016);
    }
    expect(s.spawnCount).toBe(0);
  });

  it('bursts both blades on the catch crossing (phase wraps 0.9 → 0.05)', () => {
    const s = createOarSplashState();
    s.lastPhase = 0.9;
    updateOarSplash(s, 0, 0, 0, 0.05, true, 0.016);
    expect(s.spawnCount).toBe(OAR_SPLASH_BURST_SIZE * 2); // port + starboard
    expect(activeOarSplashCount(s)).toBe(OAR_SPLASH_BURST_SIZE * 2);
  });

  it('bursts both blades on the finish crossing (phase 0.45 → 0.55)', () => {
    const s = createOarSplashState();
    s.lastPhase = 0.45;
    updateOarSplash(s, 0, 0, 0, 0.55, true, 0.016);
    expect(s.spawnCount).toBe(OAR_SPLASH_BURST_SIZE * 2);
  });

  it('skips bursts when the phase step stays within [0, 0.5] (mid-drive)', () => {
    const s = createOarSplashState();
    s.lastPhase = 0.2;
    updateOarSplash(s, 0, 0, 0, 0.3, true, 0.016);
    expect(s.spawnCount).toBe(0);
  });

  it('places the burst at the heading-rotated blade tips (heading 0)', () => {
    const s = createOarSplashState();
    s.lastPhase = 0.4;
    // Signature: (state, boatWorldX, boatWorldZ, heading, phase, isPlaying, dt)
    updateOarSplash(s, 10, 5, 0, 0.6, true, 0.016); // crosses finish
    // Heading 0 → starboard = (cos 0, -sin 0) = (1, 0). Port blade sits at
    // (10 - 2.4, _, 5), starboard at (10 + 2.4, _, 5). Spread ±0.3 m.
    const stride = OAR_SPLASH_FLOATS_PER_PARTICLE;
    const first = s.pool.subarray(0, stride);
    const stbdBurstFirst = s.pool.subarray(stride * OAR_SPLASH_BURST_SIZE, stride * (OAR_SPLASH_BURST_SIZE + 1));
    expect(first[0]).toBeCloseTo(10 - OAR_SPLASH_LATERAL_OFFSET_METRES, 0);
    expect(first[2]).toBeCloseTo(5, 0);
    expect(stbdBurstFirst[0]).toBeCloseTo(10 + OAR_SPLASH_LATERAL_OFFSET_METRES, 0);
    expect(stbdBurstFirst[2]).toBeCloseTo(5, 0);
  });

  it('rotates blade placement with the heading (heading 90°)', () => {
    const s = createOarSplashState();
    s.lastPhase = 0.4;
    // Heading π/2 → starboard = (cos 90°, -sin 90°) = (0, -1). Port sits
    // along +Z from the hull, starboard along -Z.
    updateOarSplash(s, 0, 0, Math.PI / 2, 0.6, true, 0.016);
    const stride = OAR_SPLASH_FLOATS_PER_PARTICLE;
    const first = s.pool.subarray(0, stride);
    const stbdBurstFirst = s.pool.subarray(stride * OAR_SPLASH_BURST_SIZE, stride * (OAR_SPLASH_BURST_SIZE + 1));
    expect(first[0]).toBeCloseTo(0, 0);
    expect(first[2]).toBeCloseTo(OAR_SPLASH_LATERAL_OFFSET_METRES, 0);
    expect(stbdBurstFirst[0]).toBeCloseTo(0, 0);
    expect(stbdBurstFirst[2]).toBeCloseTo(-OAR_SPLASH_LATERAL_OFFSET_METRES, 0);
  });

  it('ages particles out of the active window once lifetime elapses', () => {
    const s = createOarSplashState();
    s.lastPhase = 0.9;
    updateOarSplash(s, 0, 0, 0, 0.05, true, 0.016);
    expect(activeOarSplashCount(s)).toBe(OAR_SPLASH_BURST_SIZE * 2);
    updateOarSplash(s, 0, 0, 0, 0.05, false, OAR_SPLASH_LIFETIME_SEC + 0.1);
    expect(activeOarSplashCount(s)).toBe(0);
  });

  it('tolerates dt=0 and negative dt without NaN or stale spawns', () => {
    const s = createOarSplashState();
    s.lastPhase = 0.9;
    updateOarSplash(s, 0, 0, 0, 0.05, true, 0.016);
    const beforeAge = s.pool[3];
    updateOarSplash(s, 0, 0, 0, 0.05, true, 0);
    expect(s.pool[3]).toBe(beforeAge);
    updateOarSplash(s, 0, 0, 0, 0.05, true, -0.5);
    expect(Number.isFinite(s.pool[3])).toBe(true);
    expect(s.pool[3]).toBe(beforeAge);
  });
});
