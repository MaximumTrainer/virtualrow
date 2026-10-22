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
  drawBloom: true,
  drawVignette: true,
  drawLut: true,
  drawSsao: false,
  drawDof: false,
};
const low = {
  drawBuildings: true,
  drawClouds: false,
  castBuildingShadows: false,
  drawCrew: true,
  castCharacterShadows: false,
  drawBloom: true,
  drawVignette: true,
  drawLut: true,
  drawSsao: false,
  drawDof: false,
};
const medium = {
  drawBuildings: true,
  drawClouds: true,
  castBuildingShadows: true,
  drawCrew: true,
  castCharacterShadows: true,
  drawBloom: true,
  drawVignette: true,
  drawLut: true,
  drawSsao: false,
  drawDof: false,
};
const high = {
  drawBuildings: true,
  drawClouds: true,
  castBuildingShadows: true,
  drawCrew: true,
  castCharacterShadows: true,
  drawBloom: true,
  drawVignette: true,
  drawLut: true,
  drawSsao: true,
  drawDof: false,
};
const extraHigh = {
  drawBuildings: true,
  drawClouds: true,
  castBuildingShadows: true,
  drawCrew: true,
  castCharacterShadows: true,
  drawBloom: true,
  drawVignette: true,
  drawLut: true,
  drawSsao: true,
  drawDof: true,
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
});
