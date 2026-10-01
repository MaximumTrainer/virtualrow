import type { PerformanceMode } from './constants';
import type { SceneConfig } from './themeConfig';

/**
 * Which lights the scene has, and how strong (issue #349).
 *
 * `RowerScene` lit with four: a hemisphere, the sun, an ambient and a second
 * directional fill. Three of those exist to fake what an environment map does
 * properly — and the scene had no usable one. `PMREMEnvironment` captured the
 * live scene on mount, before `Sky` had drawn, so the map was near-black and
 * every `MeshStandard`/`MeshPhysical` material had nothing to reflect. That is
 * why the hull read as matte plastic and the rigger as dark grey.
 *
 * With a real sky environment the ambient and the fill are subtracting
 * contrast for nothing, so they go. What is left is the sun, a hemisphere for
 * the ground bounce, and the sky itself.
 *
 * Pure: the scene reads the result, and every colour comes from the config the
 * conditions presets resolve (#346) rather than from a literal in JSX.
 */

/** Tiers, dimmest first, so a test can assert the order rather than restate it. */
export const QUALITY_TIERS_BY_LIGHT: readonly PerformanceMode[] = [
  'basic',
  'low',
  'medium',
  'high',
  'extra-high',
] as const;

/**
 * How much of the sky's light reaches the materials, per tier.
 *
 * Never zero, even at the bottom. The environment is what the flat-colour GLB
 * kit picks its sky tint up from, and with none of it the kit is the matte
 * plastic this issue is about.
 *
 * `high` moves from the original 0.12 to 0.24 across #433's retune, together
 * with a matching lift to the dusk preset's `ambientIntensity` (0.9 → 1.05).
 * The three tiers' numbers were fit against the automation scene, which drops
 * the PMREM sky map — so under the shipping scene the water at `high` takes
 * more sky than the numbers were calibrated for and the classifier used to
 * lose the bank-water contrast at low sun. The shipping water shader at
 * `high` samples the environment map for its reflection, and at dusk the
 * sky is dim enough that the water read near-black and collapsed into the
 * bank at 0.14; only the `high` tier is affected, so the lift is here rather
 * than a change to the dusk sky. The twin lift on the dusk ambient carries
 * the bank up a step at the preset the last failure concentrated in.
 */
const ENVIRONMENT_INTENSITY: Record<PerformanceMode, number> = {
  // Five tiers (#455 D1). The two extremes keep their calibrated #433 values;
  // the three middle tiers interpolate along the same axis.
  //
  // `high` matches `extra-high` at 0.24 on purpose. Interpolated values
  // (0.14 in #455 Phase 1, then 0.20 as a first bump) both put the water
  // shader's sampled environment map near-black at dusk, so the bank-water
  // contrast collapses — exactly what #433 saw at the pre-retune `high` =
  // 0.12 and what endurance CI reproduced here with huge run-to-run
  // variance on the 8% threshold. The tier distinction between `high` and
  // `extra-high` rests on the effect plan (godRays only at extra-high,
  // DoF+SSAO at high), which is the meaningful quality boundary; the
  // environment-map intensity has to clear the dusk-water floor on both.
  basic: 0.05,
  low: 0.06,
  medium: 0.08,
  high: 0.24,
  'extra-high': 0.24,
};

/**
 * The ground bounce, at the strength the scene was built around.
 *
 * The issue asks for 0.25 here. Measured, that is much too dark: the
 * hemisphere is what lights the distant scenery and the far bank, and dropping
 * it from 0.9 to 0.25 took the top of the frame from 138 to 108 while the
 * environment brightened the water underneath it — two errors pulling opposite
 * ways, and `scene-contrast.spec.ts` failed on the result with no horizon left
 * between them. The environment is here to give the hull and the riggers
 * something to reflect, not to relight the world.
 */
const HEMISPHERE_BASE = 0.9;

/** The authored ambient strength, which `HEMISPHERE_BASE` is calibrated to. */
const AUTHORED_AMBIENT = 0.25;

export interface HemispherePlan {
  /** Colour from above. */
  sky: string;
  /** Colour bounced from below — the bank the boat is between. */
  ground: string;
  intensity: number;
}

export interface SunPlan {
  color: string;
  intensity: number;
  /** Degrees above the horizon. */
  elevation: number;
  /** Degrees clockwise from north. */
  azimuth: number;
}

export interface LightingPlan {
  /** `scene.environmentIntensity` — how much the sky map lights materials. */
  environmentIntensity: number;
  hemisphere: HemispherePlan;
  sun: SunPlan;
}

export const lightingPlan = (mode: PerformanceMode, config: SceneConfig): LightingPlan => ({
  environmentIntensity: ENVIRONMENT_INTENSITY[mode] ?? ENVIRONMENT_INTENSITY.medium,
  hemisphere: {
    sky: config.lighting.ambientColor,
    ground: config.bank.flatColor,
    /*
     * The config's own ambient strength, not a constant.
     *
     * The conditions presets scale `ambientIntensity` — overcast raises it,
     * because an overcast sky is bright and directionless — and a hemisphere
     * pinned to a number would ignore the one preset whose whole character is
     * diffuse light. The authored value is 0.25, which is what this issue asks
     * the ground bounce to be.
     */
    intensity: HEMISPHERE_BASE * (config.lighting.ambientIntensity / AUTHORED_AMBIENT),
  },
  sun: {
    color: config.lighting.sunColor,
    intensity: config.lighting.sunIntensity,
    elevation: config.lighting.sunElevation,
    azimuth: config.lighting.sunAzimuth,
  },
});
