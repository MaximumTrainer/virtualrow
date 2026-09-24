import { describe, it, expect } from 'vitest';
import { lightingPlan, QUALITY_TIERS_BY_LIGHT } from '../components/rower3d/lightingPlan';
import { SCENE_CONFIG } from '../components/rower3d/themeConfig';
import { CONDITIONS, applyConditions } from '../components/rower3d/conditions';

/**
 * Issue #349 — the sky lights the scene.
 *
 * `RowerScene` lit with four lights: a hemisphere, the sun, an ambient and a
 * second directional fill. Three of those exist to fake what an environment
 * map does properly, and the scene had no usable one — `PMREMEnvironment`
 * captured the live scene on mount, before `Sky` had drawn, so the map was
 * near-black and every `MeshStandard`/`MeshPhysical` material in the scene had
 * nothing to reflect. That is why the hull read as matte plastic and the
 * rigger as dark grey.
 *
 * This is the decision half: which lights exist and how strong, as a pure
 * function of the tier and the scene config the conditions presets resolve.
 */

describe('how strongly the sky lights the scene', () => {
  it('rises with the tier', () => {
    const strengths = QUALITY_TIERS_BY_LIGHT.map(
      (tier) => lightingPlan(tier, SCENE_CONFIG).environmentIntensity,
    );

    expect(strengths).toEqual([...strengths].sort((a, b) => a - b));
    expect(new Set(strengths).size, 'two tiers light the scene identically').toBe(
      QUALITY_TIERS_BY_LIGHT.length,
    );
  });

  // Never zero, even at the bottom: the environment is what the flat-colour
  // GLB kit picks its sky tint up from, and without any of it the kit is the
  // matte plastic this issue is about.
  it('is never switched off entirely', () => {
    for (const tier of QUALITY_TIERS_BY_LIGHT) {
      expect(lightingPlan(tier, SCENE_CONFIG).environmentIntensity, tier).toBeGreaterThan(0);
    }
  });
});

describe('the lights that remain', () => {
  /**
   * One hemisphere and one sun.
   *
   * The ambient light and the second directional fill were flattening the
   * scene to make up for an environment map that was black. With a real one
   * they are subtracting contrast for nothing.
   */
  it('keeps a hemisphere for the ground bounce and nothing else but the sun', () => {
    const plan = lightingPlan('high', SCENE_CONFIG);

    expect(plan.hemisphere).toBeTruthy();
    expect(plan.sun).toBeTruthy();
    expect(plan).not.toHaveProperty('ambient');
    expect(plan).not.toHaveProperty('fill');
  });

  it('takes every colour from the config rather than from a literal', () => {
    const plan = lightingPlan('high', SCENE_CONFIG);

    expect(plan.hemisphere.sky).toBe(SCENE_CONFIG.lighting.ambientColor);
    expect(plan.hemisphere.ground).toBe(SCENE_CONFIG.bank.flatColor);
    expect(plan.sun.color).toBe(SCENE_CONFIG.lighting.sunColor);
  });

  it('carries the sun’s own angles, so one function places it everywhere', () => {
    const plan = lightingPlan('high', SCENE_CONFIG);

    expect(plan.sun.elevation).toBe(SCENE_CONFIG.lighting.sunElevation);
    expect(plan.sun.azimuth).toBe(SCENE_CONFIG.lighting.sunAzimuth);
    expect(plan.sun.intensity).toBe(SCENE_CONFIG.lighting.sunIntensity);
  });

  /**
   * The ground bounce is the config's own ambient strength.
   *
   * Not a flat 0.25: the conditions presets (#346) scale `ambientIntensity` —
   * overcast raises it, because an overcast sky is bright and directionless —
   * and a hemisphere pinned to a constant would ignore the one preset whose
   * whole character is diffuse light.
   */
  it('lets the conditions move the ground bounce', () => {
    const overcast = applyConditions(SCENE_CONFIG, 'overcast');
    const dusk = applyConditions(SCENE_CONFIG, 'dusk');

    expect(lightingPlan('high', overcast).hemisphere.intensity).toBeGreaterThan(
      lightingPlan('high', dusk).hemisphere.intensity,
    );
  });

  it('is the authored ambient strength under the authored config', () => {
    expect(lightingPlan('high', SCENE_CONFIG).hemisphere.intensity).toBe(
      SCENE_CONFIG.lighting.ambientIntensity,
    );
  });
});

describe('every preset still lights a scene somebody can see', () => {
  it('never asks for a negative or absent light', () => {
    for (const condition of CONDITIONS) {
      const config = applyConditions(SCENE_CONFIG, condition);

      for (const tier of QUALITY_TIERS_BY_LIGHT) {
        const plan = lightingPlan(tier, config);

        expect(plan.environmentIntensity, `${condition}/${tier}`).toBeGreaterThan(0);
        expect(plan.hemisphere.intensity, `${condition}/${tier}`).toBeGreaterThan(0);
        expect(plan.sun.intensity, `${condition}/${tier}`).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

/**
 * `performanceMode` is a string that arrives from a URL flag and from stored
 * preferences, so a tier the table has never heard of is reachable without
 * anybody writing a bug — and the scene still has to be lit.
 */
describe('a tier nobody planned for', () => {
  it('is lit like the middle one rather than not at all', () => {
    const unknown = lightingPlan('ultra' as never, SCENE_CONFIG);

    expect(unknown.environmentIntensity).toBe(lightingPlan('auto', SCENE_CONFIG).environmentIntensity);
  });
});
