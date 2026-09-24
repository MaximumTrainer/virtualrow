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
export const QUALITY_TIERS_BY_LIGHT: readonly PerformanceMode[] = ['low', 'auto', 'high'] as const;

/**
 * How much of the sky's light reaches the materials, per tier.
 *
 * Never zero, even at the bottom. The environment is what the flat-colour GLB
 * kit picks its sky tint up from, and with none of it the kit is the matte
 * plastic this issue is about.
 */
const ENVIRONMENT_INTENSITY: Record<PerformanceMode, number> = {
  low: 0.05,
  auto: 0.08,
  high: 0.12,
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
  environmentIntensity: ENVIRONMENT_INTENSITY[mode] ?? ENVIRONMENT_INTENSITY.auto,
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
