import { describe, expect, it } from 'vitest';
import { tierCapsFor } from '../tierCaps';

// Full-shape expected caps for each tier so a new flag is caught in one
// place rather than drifting between the implementation and the test.
const basic = {
  drawBuildings: false,
  drawClouds: false,
  castBuildingShadows: false,
  drawCrew: false,
  castCharacterShadows: false,
  castFloraShadows: false,
  castSceneryShadows: false,
  drawBloom: true,
  drawVignette: true,
  drawLut: true,
  drawSsao: false,
  drawDof: false,
  drawAutoExposure: false,
  drawChromaticAberration: false,
  drawRainOverlay: false,
};
const low = {
  drawBuildings: true,
  drawClouds: false,
  castBuildingShadows: false,
  drawCrew: true,
  castCharacterShadows: false,
  castFloraShadows: false,
  castSceneryShadows: false,
  drawBloom: true,
  drawVignette: true,
  drawLut: true,
  drawSsao: false,
  drawDof: false,
  drawAutoExposure: false,
  drawChromaticAberration: false,
  drawRainOverlay: true,
};
const medium = {
  drawBuildings: true,
  drawClouds: true,
  castBuildingShadows: true,
  drawCrew: true,
  castCharacterShadows: true,
  castFloraShadows: true,
  castSceneryShadows: true,
  drawBloom: true,
  drawVignette: true,
  drawLut: true,
  drawSsao: false,
  drawDof: false,
  drawAutoExposure: false,
  drawChromaticAberration: false,
  drawRainOverlay: true,
};
const high = {
  drawBuildings: true,
  drawClouds: true,
  castBuildingShadows: true,
  drawCrew: true,
  castCharacterShadows: true,
  castFloraShadows: true,
  castSceneryShadows: true,
  drawBloom: true,
  drawVignette: true,
  drawLut: true,
  drawSsao: true,
  drawDof: false,
  drawAutoExposure: true,
  drawChromaticAberration: true,
  drawRainOverlay: true,
};
const extraHigh = {
  drawBuildings: true,
  drawClouds: true,
  castBuildingShadows: true,
  drawCrew: true,
  castCharacterShadows: true,
  castFloraShadows: true,
  castSceneryShadows: true,
  drawBloom: true,
  drawVignette: true,
  drawLut: true,
  drawSsao: true,
  drawDof: true,
  drawAutoExposure: true,
  drawChromaticAberration: true,
  drawRainOverlay: true,
};

describe('tierCaps (P6 D8 + P7 D9 + P8 D8)', () => {
  it('basic: no buildings, no clouds, no crew; bloom/vignette/LUT universal', () => {
    expect(tierCapsFor('basic')).toEqual(basic);
  });

  it('low: buildings + crew; no SSAO/DOF', () => {
    expect(tierCapsFor('low')).toEqual(low);
  });

  it('medium: all shadow casts; no SSAO/DOF', () => {
    expect(tierCapsFor('medium')).toEqual(medium);
  });

  it('high: SSAO on; DOF still off', () => {
    expect(tierCapsFor('high')).toEqual(high);
  });

  it('extra-high: SSAO + DOF on', () => {
    expect(tierCapsFor('extra-high')).toEqual(extraHigh);
  });

  it('an unknown tier string falls back to the default (medium) caps', () => {
    expect(tierCapsFor('fancy')).toEqual(tierCapsFor('medium'));
  });

  it('undefined falls back to the default caps', () => {
    expect(tierCapsFor(undefined)).toEqual(tierCapsFor('medium'));
  });

  it('rain overlay is off on basic, available from low upward (#574)', () => {
    expect(tierCapsFor('basic').drawRainOverlay).toBe(false);
    for (const t of ['low', 'medium', 'high', 'extra-high'] as const) {
      expect(tierCapsFor(t).drawRainOverlay, t).toBe(true);
    }
  });

  it('flora + scenery shadow casts turn on at medium and stay on above (#591-fu P1c)', () => {
    for (const t of ['basic', 'low'] as const) {
      expect(tierCapsFor(t).castFloraShadows, t).toBe(false);
      expect(tierCapsFor(t).castSceneryShadows, t).toBe(false);
    }
    for (const t of ['medium', 'high', 'extra-high'] as const) {
      expect(tierCapsFor(t).castFloraShadows, t).toBe(true);
      expect(tierCapsFor(t).castSceneryShadows, t).toBe(true);
    }
  });

  it('auto-exposure turns on at high and stays on above (#574)', () => {
    for (const t of ['basic', 'low', 'medium'] as const) {
      expect(tierCapsFor(t).drawAutoExposure, t).toBe(false);
    }
    for (const t of ['high', 'extra-high'] as const) {
      expect(tierCapsFor(t).drawAutoExposure, t).toBe(true);
    }
  });

  it('chromatic aberration turns on at high and stays on above (#574)', () => {
    for (const t of ['basic', 'low', 'medium'] as const) {
      expect(tierCapsFor(t).drawChromaticAberration, t).toBe(false);
    }
    for (const t of ['high', 'extra-high'] as const) {
      expect(tierCapsFor(t).drawChromaticAberration, t).toBe(true);
    }
  });
});
