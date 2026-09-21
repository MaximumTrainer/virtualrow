import { describe, it, expect } from 'vitest';
import { sceneExposure } from '../components/rower3d/sceneExposure';
import { getThemeConfig } from '../components/rower3d/themeConfig';
import type { RouteTheme } from '../components/rower3d/themeConfig';

/**
 * Every theme authors a sky exposure and nothing read it: the canvas hardcoded
 * toneMappingExposure to 1.0. drei's Sky outputs high dynamic range, so at 1.0
 * the sky renders white — and the reflective water with it, which is why 79% of
 * a rendered frame came back near-white and the channel could not be told from
 * the bank (#269).
 */
/** One theme since #361, and the loop below still reads as the rule it is. */
const THEMES: RouteTheme[] = ['willowbrook'];

describe('sceneExposure', () => {
  it('uses the exposure the theme authored', () => {
    const theme: RouteTheme = 'willowbrook';
    const authored = getThemeConfig(theme).sky.exposure;

    expect(sceneExposure(theme, 0)).toBeCloseTo(authored, 5);
  });

  it('never returns the hardcoded 1.0 for a theme that asked for less', () => {
    // The specific regression: a sky authored at 0.55 rendered at 1.0.
    const authored = getThemeConfig('willowbrook').sky.exposure;
    expect(authored).toBeLessThan(1);
    expect(sceneExposure('willowbrook', 0)).toBeLessThan(1);
  });

  it('darkens a little at speed, relative to the theme rather than to 1.0', () => {
    const still = sceneExposure('willowbrook', 0);
    const fast = sceneExposure('willowbrook', 6);

    expect(fast).toBeLessThan(still);
    expect(fast).toBeGreaterThan(still * 0.5);
  });

  it('gives every theme a usable exposure', () => {
    for (const theme of THEMES) {
      const value = sceneExposure(theme, 0);
      expect(Number.isFinite(value)).toBe(true);
      expect(value).toBeGreaterThan(0.05);
      expect(value).toBeLessThanOrEqual(1.5);
    }
  });

  it('survives a velocity that is not a number', () => {
    expect(Number.isFinite(sceneExposure('willowbrook', Number.NaN))).toBe(true);
  });
});
