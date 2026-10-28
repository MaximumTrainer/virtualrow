import { describe, expect, it } from 'vitest';

import {
  BUILDING_ATLAS_SIZE,
  BUILDING_ATLAS_HALF,
  WALL_U_OFFSET,
  ROOF_U_OFFSET,
  paintBuildingAtlas,
} from '../buildingAtlas';

/**
 * Atlas layout contract — the shader (`buildings.wgsl`) depends on the two
 * halves of the atlas carrying wall vs roof patterns, and on `*_U_OFFSET`
 * matching the sampling arithmetic there. Changing either side of this
 * contract has to come paired with a shader change.
 */
describe('paintBuildingAtlas (#591-fu P0a)', () => {
  it('exposes the atlas layout constants the shader samples with', () => {
    expect(BUILDING_ATLAS_SIZE).toBe(128);
    expect(BUILDING_ATLAS_HALF).toBe(64);
    expect(WALL_U_OFFSET).toBe(0);
    expect(ROOF_U_OFFSET).toBe(0.5);
  });

  it('produces a 128×128 RGBA buffer with alpha 255 everywhere', () => {
    const pixels = paintBuildingAtlas();
    expect(pixels.length).toBe(BUILDING_ATLAS_SIZE * BUILDING_ATLAS_SIZE * 4);
    for (let i = 3; i < pixels.length; i += 4) expect(pixels[i]).toBe(255);
  });

  it('is deterministic across calls', () => {
    expect(paintBuildingAtlas()).toEqual(paintBuildingAtlas());
  });

  it('writes distinct patterns on the two halves (wall vs roof)', () => {
    const pixels = paintBuildingAtlas();
    // Compare a few sample texels from the left half to the mirrored
    // position on the right half — the bricks shouldn't line up with the
    // roof tiles, so the two halves must differ.
    let differingSamples = 0;
    const samples = 40;
    for (let s = 0; s < samples; s += 1) {
      const y = Math.floor((s / samples) * (BUILDING_ATLAS_SIZE - 1));
      const xLeft = (s * 3) % BUILDING_ATLAS_HALF;
      const xRight = BUILDING_ATLAS_HALF + xLeft;
      const iL = (y * BUILDING_ATLAS_SIZE + xLeft) * 4;
      const iR = (y * BUILDING_ATLAS_SIZE + xRight) * 4;
      if (
        pixels[iL] !== pixels[iR] ||
        pixels[iL + 1] !== pixels[iR + 1] ||
        pixels[iL + 2] !== pixels[iR + 2]
      ) differingSamples += 1;
    }
    expect(differingSamples).toBeGreaterThan(samples * 0.7);
  });

  it('both halves are non-trivial (not solid colour) — bricks and tiles vary', () => {
    const pixels = paintBuildingAtlas();
    const uniqueR = new Set<number>();
    const uniqueG = new Set<number>();
    for (let y = 0; y < BUILDING_ATLAS_SIZE; y += 1) {
      for (let x = 0; x < BUILDING_ATLAS_SIZE; x += 1) {
        const i = (y * BUILDING_ATLAS_SIZE + x) * 4;
        uniqueR.add(pixels[i]);
        uniqueG.add(pixels[i + 1]);
      }
    }
    // A single-colour buffer would have 1 or 2 unique values; a real pattern
    // with mortar + brick + tile + jitter sits well above 20.
    expect(uniqueR.size).toBeGreaterThan(20);
    expect(uniqueG.size).toBeGreaterThan(20);
  });

  it('respects a custom size parameter (used by the KTX2 follow-up at 256)', () => {
    const pixels = paintBuildingAtlas(64);
    expect(pixels.length).toBe(64 * 64 * 4);
    for (let i = 3; i < pixels.length; i += 4) expect(pixels[i]).toBe(255);
  });
});
