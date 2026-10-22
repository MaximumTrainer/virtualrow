import { describe, expect, it } from 'vitest';
import { makeMockDevice } from './_mockWebGPU';
import {
  BUILDING_PROFILE_INDEX,
  BUILDINGS_FLOATS_PER_INSTANCE,
  buildSmokeBuildings,
  createBuildingPool,
  packBuildings,
  packBuildingSizes,
  type BuildingSpec,
} from '../plan/buildings';

describe('buildings plan (P6 FR1 / D1-b / D3-a)', () => {
  const specs: BuildingSpec[] = [
    { x: 10, z: -5, halfWidth: 3, halfDepth: 4, height: 12, profile: 'residential' },
    { x: -10, z: -25, halfWidth: 2, halfDepth: 2, height: 7, profile: 'commercial' },
    { x: 5, z: -45, halfWidth: 4, halfDepth: 3, height: 20 }, // falls back
  ];

  it('packs (x, z, height, bitcast(paletteIndex)) per instance', () => {
    const plan = packBuildings(specs);
    expect(plan.instanceCount).toBe(3);
    expect(plan.instances.length).toBe(3 * BUILDINGS_FLOATS_PER_INSTANCE);
    expect(plan.instances[0]).toBe(10);
    expect(plan.instances[1]).toBe(-5);
    expect(plan.instances[2]).toBe(12);
    // Fourth lane carries the u32 palette index.
    const meta32 = new Uint32Array(plan.instances.buffer);
    expect(meta32[3]).toBe(BUILDING_PROFILE_INDEX.residential);
    expect(meta32[7]).toBe(BUILDING_PROFILE_INDEX.commercial);
    expect(meta32[11]).toBe(BUILDING_PROFILE_INDEX.fallback);
  });

  it('computes footprintM2 from halfWidth × halfDepth × 4', () => {
    const plan = packBuildings(specs);
    // 3*4*4 + 2*2*4 + 4*3*4 = 48 + 16 + 48 = 112
    expect(plan.footprintM2).toBeCloseTo(112, 5);
  });

  it('clamps negative heights to zero', () => {
    const plan = packBuildings([
      { x: 0, z: 0, halfWidth: 1, halfDepth: 1, height: -3, profile: 'commercial' },
    ]);
    expect(plan.instances[2]).toBe(0);
  });

  it('packBuildingSizes keeps a minimum half-size so the shader never gets a zero prism', () => {
    const sizes = packBuildingSizes([
      { x: 0, z: 0, halfWidth: 0, halfDepth: 0, height: 1 },
      { x: 0, z: 0, halfWidth: 2, halfDepth: 3, height: 1 },
    ]);
    expect(sizes[0]).toBeGreaterThan(0);
    expect(sizes[1]).toBeGreaterThan(0);
    expect(sizes[2]).toBe(2);
    expect(sizes[3]).toBe(3);
  });

  it('createBuildingPool uploads both centres + sizes and disposes both', () => {
    const device = makeMockDevice();
    const pool = createBuildingPool(device, specs);
    expect(pool.instanceCount).toBe(3);
    expect(pool.footprintM2).toBeCloseTo(112, 5);
    pool.dispose();
    pool.dispose(); // idempotent
    expect(device.__log.destroyedBuffers).toBe(2);
  });

  it('creates an empty pool without zero-sized buffers', () => {
    const device = makeMockDevice();
    const pool = createBuildingPool(device, []);
    expect(pool.instanceCount).toBe(0);
    expect(pool.footprintM2).toBe(0);
    pool.dispose();
    expect(device.__log.destroyedBuffers).toBe(2);
  });

  it('buildSmokeBuildings produces a deterministic alternating-profile set', () => {
    const specs = buildSmokeBuildings({ count: 8 });
    expect(specs.length).toBe(8);
    // Every spec has a profile index in range.
    for (const s of specs) {
      expect(s.profile).toBeDefined();
      expect(BUILDING_PROFILE_INDEX[s.profile!]).toBeGreaterThanOrEqual(0);
      expect(BUILDING_PROFILE_INDEX[s.profile!]).toBeLessThanOrEqual(3);
    }
    // Odd/even alternates sides along X.
    expect(Math.sign(specs[0].x)).toBe(-1);
    expect(Math.sign(specs[1].x)).toBe(1);
  });
});
