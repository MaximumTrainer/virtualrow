import { describe, it, expect } from 'vitest';
import { sceneExposure } from '../components/rower3d/sceneExposure';
import { SCENE_CONFIG } from '../components/rower3d/themeConfig';

/**
 * The config authors a sky exposure and nothing read it: the canvas hardcoded
 * toneMappingExposure to 1.0. drei's Sky outputs high dynamic range, so at 1.0
 * the sky renders white — and the reflective water with it, which is why 79% of
 * a rendered frame came back near-white and the channel could not be told from
 * the bank (#269).
 */
describe('sceneExposure', () => {
  it('uses the exposure the config authored', () => {
    expect(sceneExposure(0)).toBeCloseTo(SCENE_CONFIG.sky.exposure, 5);
  });

  it('never returns the hardcoded 1.0 when the config asked for less', () => {
    // The specific regression: a sky authored at 0.55 rendered at 1.0.
    expect(SCENE_CONFIG.sky.exposure).toBeLessThan(1);
    expect(sceneExposure(0)).toBeLessThan(1);
  });

  it('darkens a little at speed, relative to the config rather than to 1.0', () => {
    const still = sceneExposure(0);
    const fast = sceneExposure(6);

    expect(fast).toBeLessThan(still);
    expect(fast).toBeGreaterThan(still * 0.5);
  });

  it('is a usable exposure', () => {
    const value = sceneExposure(0);
    expect(Number.isFinite(value)).toBe(true);
    expect(value).toBeGreaterThan(0.05);
    expect(value).toBeLessThanOrEqual(1.5);
  });

  it('survives a velocity that is not a number', () => {
    expect(Number.isFinite(sceneExposure(Number.NaN))).toBe(true);
  });
});
