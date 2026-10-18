import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { installCanvasMock } from './canvasMock';
import {
  biomeDensityStrengthFor,
  createBiomeDensityTile,
  createBiomeDensityTexture,
} from '../components/rower3d/foliageTexture';
import { SCENERY_PROFILES } from '../components/rower3d/sceneryConfig';

/**
 * Issue #496 — Phase 1: the per-biome grass density tile the shader will sample.
 *
 * The tile is a greyscale 2D field whose mean matches the biome's
 * `groundCover.density`, so the shader multiplies it against grass colour and
 * paints bank slopes in proportion to how planted the biome is in the OSM
 * profile. Phase 2 wires it into the bank material; this phase ships the
 * generator and the per-biome mean so a baseline fingerprint can be checked
 * without a GPU.
 */

const SIZE = 64;

/** Mean of the red channel over the tile, 0..1. */
const meanDensity = (pixels: Uint8ClampedArray, size: number): number => {
  let total = 0;
  for (let i = 0; i < size * size; i += 1) total += pixels[i * 4];
  return total / (size * size * 255);
};

describe('createBiomeDensityTile (#496 Phase 1)', () => {
  it.each(Object.keys(SCENERY_PROFILES) as Array<keyof typeof SCENERY_PROFILES>)(
    'returns a size²·4 RGBA buffer for the %s biome',
    (profile) => {
      const pixels = createBiomeDensityTile(profile, SIZE);
      expect(pixels.length).toBe(SIZE * SIZE * 4);
    },
  );

  it('is deterministic — the same biome twice gives identical pixels', () => {
    const a = createBiomeDensityTile('forest', SIZE);
    const b = createBiomeDensityTile('forest', SIZE);
    expect(Array.from(a)).toEqual(Array.from(b));
  });

  it("tracks the biome's groundCover density on average", () => {
    // Forest at 0.85 should be clearly denser than commercial at 0.2.
    const forest = meanDensity(createBiomeDensityTile('forest', SIZE), SIZE);
    const commercial = meanDensity(createBiomeDensityTile('commercial', SIZE), SIZE);
    expect(forest).toBeGreaterThan(commercial);
    // The tile means the biome's density within ±0.15 — noise jitter is bounded.
    expect(Math.abs(forest - SCENERY_PROFILES.forest.groundCover.density)).toBeLessThan(0.15);
    expect(Math.abs(commercial - SCENERY_PROFILES.commercial.groundCover.density)).toBeLessThan(0.15);
  });

  it('writes alpha = 255 everywhere (density lives in R; RGBA for canvas compatibility)', () => {
    const pixels = createBiomeDensityTile('fallback', SIZE);
    for (let i = 0; i < SIZE * SIZE; i += 1) {
      expect(pixels[i * 4 + 3]).toBe(255);
    }
  });
});

describe('biomeDensityStrengthFor (#496 Phase 1)', () => {
  it('returns each biome\'s groundCover density', () => {
    for (const profile of Object.keys(SCENERY_PROFILES) as Array<keyof typeof SCENERY_PROFILES>) {
      expect(biomeDensityStrengthFor(profile)).toBe(SCENERY_PROFILES[profile].groundCover.density);
    }
  });
});

describe('createBiomeDensityTexture (#496 Phase 1)', () => {
  let uninstall: () => void;
  beforeAll(() => { uninstall = installCanvasMock(); });
  afterAll(() => uninstall());

  it('wraps the tile in a CanvasTexture of the asked-for size', () => {
    const tex = createBiomeDensityTexture('forest', 32);
    expect(tex.image.width).toBe(32);
    expect(tex.image.height).toBe(32);
    tex.dispose();
  });
});
