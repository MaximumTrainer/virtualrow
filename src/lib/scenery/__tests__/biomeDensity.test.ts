/**
 * Parity test for the WebGPU port of #496 Phase 2's biome density tile. The
 * React painter lives at `src/components/rower3d/foliageTexture.ts`; this
 * test keeps the WebGPU port honest by asserting the same two properties
 * the React `biomeDensityTile.test.ts` asserts: deterministic bytes, and
 * mean density within ±0.15 of the biome's `groundCover.density`.
 */

import { describe, expect, it } from 'vitest';

import { paintBiomeDensityR8, paintBiomeDensityTile, meanDensity } from '../biomeDensity';
import { SCENERY_PROFILES } from '../../../components/rower3d/sceneryConfig';
import type { SceneryProfile } from '../../services/routeEnrichmentService';

const PROFILES: SceneryProfile[] = [
  'forest', 'residential', 'commercial', 'farmland', 'beach', 'wetland', 'fallback',
];

describe('paintBiomeDensityTile — ported from foliageTexture.ts', () => {
  it('produces the right pixel count per tile size', () => {
    for (const size of [16, 64, 256]) {
      expect(paintBiomeDensityTile('forest', size).length).toBe(size * size * 4);
      expect(paintBiomeDensityR8('forest', size).length).toBe(size * size);
    }
  });

  it('writes the density in R, copies to G and B, alpha 255', () => {
    const tile = paintBiomeDensityTile('wetland', 16);
    for (let i = 0; i < tile.length; i += 4) {
      expect(tile[i + 1]).toBe(tile[i]);
      expect(tile[i + 2]).toBe(tile[i]);
      expect(tile[i + 3]).toBe(255);
    }
  });

  it('matches the RGBA R channel with the R8 fast-path, byte-for-byte', () => {
    const rgba = paintBiomeDensityTile('forest', 64);
    const r8 = paintBiomeDensityR8('forest', 64);
    for (let i = 0; i < r8.length; i += 1) expect(r8[i]).toBe(rgba[i * 4]);
  });

  it('is deterministic for a given (profile, size)', () => {
    const a = paintBiomeDensityR8('wetland', 128);
    const b = paintBiomeDensityR8('wetland', 128);
    expect(Array.from(a).slice(0, 32)).toEqual(Array.from(b).slice(0, 32));
    expect(a).toEqual(b);
  });

  it('mean density lands within ±0.15 of the biome target (React invariant)', () => {
    for (const profile of PROFILES) {
      const target = SCENERY_PROFILES[profile].groundCover.density;
      const mean = meanDensity(paintBiomeDensityR8(profile, 128), 128);
      expect(Math.abs(mean - target)).toBeLessThanOrEqual(0.15);
    }
  });

  it('two different biomes paint different tiles (phase seed does its job)', () => {
    const forest = paintBiomeDensityR8('forest', 64);
    const commercial = paintBiomeDensityR8('commercial', 64);
    // Pixel-by-pixel equality would be too strong — biome means differ by
    // design, so distinct phases plus distinct target biases guarantee a
    // large fraction of differing pixels.
    let diff = 0;
    for (let i = 0; i < forest.length; i += 1) if (forest[i] !== commercial[i]) diff += 1;
    expect(diff).toBeGreaterThan(forest.length * 0.5);
  });
});
