/**
 * Three-free port of `src/components/rower3d/foliageTexture.ts`'s
 * `paintBiomeDensityTile` / `createBiomeDensityTile` (#496 Phase 2). The
 * WebGPU bank pass samples the resulting R8 tile and modulates the grass
 * contribution so a lusher biome reads lusher at the ride-view camera —
 * same job the React scene's `bankTriplanar.glsl` `grassDensityModulation`
 * chunk does, but with no DOM `<canvas>` or `THREE.CanvasTexture` so it
 * runs under JSDOM and (importantly) in the shader test suite.
 *
 * The noise function, seeds, biome-mean bias and target-density mapping
 * are deliberately byte-identical to the React painter so the WebGPU and
 * React banks paint the same patches of lushness for the same biome. The
 * `biomeDensityTile.test.ts` on main (sibling worktree) asserts the mean
 * matches `groundCover.density` within ±0.15; the ported test here keeps
 * that invariant.
 */

import { SCENERY_PROFILES } from '../../components/rower3d/sceneryConfig';
import type { SceneryProfile } from '../services/routeEnrichmentService';
import { seededRandom } from './seededRandom';

/** Per-profile phase seed; identical to React `DENSITY_SEEDS`. */
const DENSITY_SEEDS: Record<SceneryProfile, number> = {
  forest: 101,
  residential: 211,
  commercial: 317,
  farmland: 433,
  beach: 541,
  wetland: 647,
  fallback: 751,
};

/** A smoothed [0, 1] noise sample at `(x, y)` from the seeded `biomeNoise`. */
const biomeNoise = (seed: number, x: number, y: number): number => {
  // Two cosine octaves at perpendicular frequencies make a continuous field
  // without a 2-D permutation table; `seededRandom` gives each biome a
  // distinct phase so no two biomes paint the same patches.
  const phase = seededRandom(seed) * Math.PI * 2;
  const a = 0.5 + 0.5 * Math.cos(x * 0.75 + phase) * Math.cos(y * 0.75 + phase);
  const b = 0.5 + 0.5 * Math.cos(x * 2.1 + phase * 1.3) * Math.cos(y * 2.1 - phase * 0.7);
  return 0.6 * a + 0.4 * b;
};

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * RGBA pixels of a biome's grass density tile, `size` square, top row first.
 * Red carries the density; green and blue copy it (so canvas-tool inspection
 * reads the tile as greyscale); alpha is always 255.
 */
export const paintBiomeDensityTile = (
  profile: SceneryProfile,
  size: number,
): Uint8ClampedArray => {
  const pixels = new Uint8ClampedArray(size * size * 4);
  const seed = DENSITY_SEEDS[profile];
  const target = SCENERY_PROFILES[profile]?.groundCover.density ?? 0.5;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const u = x / size;
      const v = y / size;
      const n = biomeNoise(seed, u * 4, v * 4);
      // Bias the field so its mean lands on the biome's target density: `n`
      // is centred on 0.5, so `(target - 0.5)` shifts the whole tile toward
      // the target and the contrast around it is left to the noise.
      const d = clamp01(n + (target - 0.5));
      const value = Math.round(d * 255);
      const i = (y * size + x) * 4;
      pixels[i] = value;
      pixels[i + 1] = value;
      pixels[i + 2] = value;
      pixels[i + 3] = 255;
    }
  }
  return pixels;
};

/**
 * The R channel only, as a flat `Uint8Array` of size × size bytes. Suitable
 * for upload as an `r8unorm` WebGPU texture — the bank pass only reads
 * `.r`, so uploading the alpha-less variant saves 4× the bytes and skips
 * a texture format the renderer doesn't otherwise need.
 */
export const paintBiomeDensityR8 = (
  profile: SceneryProfile,
  size: number,
): Uint8Array => {
  const out = new Uint8Array(size * size);
  const seed = DENSITY_SEEDS[profile];
  const target = SCENERY_PROFILES[profile]?.groundCover.density ?? 0.5;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const u = x / size;
      const v = y / size;
      const n = biomeNoise(seed, u * 4, v * 4);
      const d = clamp01(n + (target - 0.5));
      out[y * size + x] = Math.round(d * 255);
    }
  }
  return out;
};

/** Mean density of a painted tile, used by the parity test. */
export const meanDensity = (tile: Uint8Array | Uint8ClampedArray, size: number): number => {
  let sum = 0;
  const stride = tile.length === size * size ? 1 : 4;
  const count = size * size;
  for (let i = 0; i < count; i += 1) sum += tile[i * stride];
  return sum / 255 / count;
};
