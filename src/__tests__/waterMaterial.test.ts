import { describe, it, expect } from 'vitest';
import {
  CHOP_WAVELENGTH_METRES,
  RIPPLE_TILE_METRES,
  SWELL_WAVELENGTHS_METRES,
  rippleRepeat,
  rippleScroll,
  waterMaterialPlan,
} from '../components/rower3d/waterMaterial';
import { TARGET_METERS_BETWEEN_SEGMENTS } from '../components/rower3d/curve';
import type { PerformanceMode } from '../components/rower3d/constants';

/**
 * Issue #324 — the route water was a flat emissive sheet.
 *
 * `MeshStandardMaterial { roughness 0.55, metalness 0, emissive = colour }`,
 * no normal map, nothing to reflect, and a Gerstner injection whose shortest
 * wave was 126 m long. At a boat's eye height that is not a surface; it is a
 * blue plane with a light behind it.
 */

const TIERS: PerformanceMode[] = ['low', 'auto', 'high'];

describe('waterMaterialPlan', () => {
  it('has a plan for every tier', () => {
    for (const tier of TIERS) {
      expect(waterMaterialPlan(tier), `no water plan for ${tier}`).toBeDefined();
    }
  });

  it('gets smoother as the tier rises, because a mirror needs a smooth surface', () => {
    expect(waterMaterialPlan('auto').roughness).toBeLessThan(
      waterMaterialPlan('low').roughness,
    );
    expect(waterMaterialPlan('high').roughness).toBeLessThan(
      waterMaterialPlan('auto').roughness,
    );
  });

  it('reflects more of the sky as the tier rises', () => {
    expect(waterMaterialPlan('auto').envMapIntensity).toBeGreaterThan(
      waterMaterialPlan('low').envMapIntensity,
    );
    expect(waterMaterialPlan('high').envMapIntensity).toBeGreaterThan(
      waterMaterialPlan('auto').envMapIntensity,
    );
  });

  it('puts the planar mirror on the high tier alone', () => {
    expect(waterMaterialPlan('low').useMirror).toBe(false);
    expect(waterMaterialPlan('auto').useMirror, 'auto is paying for a mirror').toBe(false);
    expect(waterMaterialPlan('high').useMirror).toBe(true);
  });

  it('never leaves the water metallic, which renders it as a hole', () => {
    // #269: with nothing to reflect, metalness rendered the surface near-black.
    for (const tier of TIERS) {
      expect(waterMaterialPlan(tier).metalness).toBe(0);
    }
  });

  it('keeps every normal scale on the surface rather than exaggerating it', () => {
    for (const tier of TIERS) {
      const { normalScale } = waterMaterialPlan(tier);
      expect(normalScale).toBeGreaterThan(0);
      expect(normalScale).toBeLessThanOrEqual(0.5);
    }
  });
});

describe('the wave scales', () => {
  /**
   * The mesh cannot carry the chop the issue asks for, and this is where that
   * is written down.
   *
   * VR-04 asks for Gerstner wavelengths of 1.5–6 m. The water channel is a
   * two-vertex-wide ribbon sampled every 15 m along the route — there is not a
   * single vertex between the two banks. A 6 m wave needs samples every 3 m to
   * exist at all, so displacing vertices at that scale produces aliasing, not
   * chop. Metre-scale detail belongs in the normal map, which is per-pixel and
   * has no sampling limit; the vertices carry the swell they can represent.
   */
  it('keeps every displaced wave long enough for the mesh to sample it', () => {
    const shortest = Math.min(...SWELL_WAVELENGTHS_METRES);
    expect(
      shortest,
      'a displaced wave shorter than two segments aliases instead of undulating',
    ).toBeGreaterThanOrEqual(TARGET_METERS_BETWEEN_SEGMENTS * 2);
  });

  it('puts the chop the issue asks for in the ripple texture instead', () => {
    expect(Math.min(...CHOP_WAVELENGTH_METRES)).toBeGreaterThanOrEqual(1.5);
    expect(Math.max(...CHOP_WAVELENGTH_METRES)).toBeLessThanOrEqual(6);
  });

  it('is chop on one scale and swell on another, not the same thing twice', () => {
    expect(Math.max(...CHOP_WAVELENGTH_METRES)).toBeLessThan(
      Math.min(...SWELL_WAVELENGTHS_METRES),
    );
  });
});

describe('rippleRepeat', () => {
  // The channel's uv runs 0–1 across the water and 0–1 along the whole route,
  // so a texture left at repeat 1 stretches one tile over kilometres. The
  // repeat has to be the route's size in tiles, or the ripples are not ripples.
  it('tiles the texture once per tile-width across the channel', () => {
    const repeat = rippleRepeat({ widthMetres: RIPPLE_TILE_METRES * 4, lengthMetres: 100 });
    expect(repeat.x).toBeCloseTo(4, 5);
  });

  it('tiles it once per tile-length along the route', () => {
    const repeat = rippleRepeat({ widthMetres: 20, lengthMetres: RIPPLE_TILE_METRES * 250 });
    expect(repeat.y).toBeCloseTo(250, 5);
  });

  it('never collapses to a single stretched tile on a degenerate route', () => {
    const repeat = rippleRepeat({ widthMetres: 0, lengthMetres: 0 });
    expect(repeat.x).toBeGreaterThanOrEqual(1);
    expect(repeat.y).toBeGreaterThanOrEqual(1);
  });

  it('holds the tile square, so ripples are not stretched down the river', () => {
    const repeat = rippleRepeat({ widthMetres: 30, lengthMetres: 3_000 });
    expect(repeat.x / repeat.y).toBeCloseTo(30 / 3_000, 5);
  });
});

describe('rippleScroll', () => {
  it('moves both layers as time passes', () => {
    const start = rippleScroll(0);
    const later = rippleScroll(10);
    expect(later.first.y).not.toBe(start.first.y);
    expect(later.second.x).not.toBe(start.second.x);
  });

  it('scrolls the two layers at different rates, so they never lock together', () => {
    const at = rippleScroll(10);
    expect(Math.abs(at.first.y)).not.toBeCloseTo(Math.abs(at.second.y), 3);
  });

  it('sends them in different directions, so the surface does not slide one way', () => {
    const at = rippleScroll(10);
    expect(Math.sign(at.first.y)).not.toBe(Math.sign(at.second.y));
  });

  it('wraps rather than growing without bound', () => {
    // A texture offset that keeps climbing loses float precision after an hour
    // of rowing, and the ripples start to judder.
    for (const t of [0, 61, 3_600, 86_400]) {
      const { first, second } = rippleScroll(t);
      for (const value of [first.x, first.y, second.x, second.y]) {
        expect(Math.abs(value)).toBeLessThanOrEqual(1);
      }
    }
  });
});
