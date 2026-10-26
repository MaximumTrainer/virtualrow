import { describe, expect, it } from 'vitest';
import { packSproutUniforms, sproutWindowFor } from '../engine/uniforms';

describe('sprout fade window (#562 FR6 / D6-b)', () => {
  it('selects per-tier fade distances in metres', () => {
    // Widened in #591-followup: narrow 6-15 m windows made the whole
    // mid-range read as flat sprite cards. The new values keep the
    // monotonic-with-tier shape asserted below.
    expect(sproutWindowFor('basic').far).toBe(10);
    expect(sproutWindowFor('low').far).toBe(12);
    expect(sproutWindowFor('medium').far).toBe(16);
    expect(sproutWindowFor('high').far).toBe(20);
    expect(sproutWindowFor('extra-high').far).toBe(26);
    expect(sproutWindowFor(undefined).far).toBe(16);
  });

  it('fades near is zero at every tier (sprites fade in from the camera)', () => {
    for (const t of ['basic', 'low', 'medium', 'high', 'extra-high']) {
      expect(sproutWindowFor(t).near).toBe(0);
    }
  });

  it('fade windows grow monotonically with tier', () => {
    const tiers = ['basic', 'low', 'medium', 'high', 'extra-high'];
    for (let i = 1; i < tiers.length; i += 1) {
      expect(sproutWindowFor(tiers[i]).far).toBeGreaterThan(sproutWindowFor(tiers[i - 1]).far);
    }
  });

  it('packSproutUniforms writes near, far, two zero pads', () => {
    const out = packSproutUniforms(1, 10);
    expect(out[0]).toBe(1);
    expect(out[1]).toBe(10);
    expect(out[2]).toBe(0);
    expect(out[3]).toBe(0);
  });
});
