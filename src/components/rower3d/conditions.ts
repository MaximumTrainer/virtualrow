import type { SceneConfig } from './themeConfig';

/**
 * Time of day and weather, per row (issue #346).
 *
 * Sun position, turbidity, cloud cover and fog were fixed in `SCENE_CONFIG`,
 * so every row on a route looked identical to the last one. A preset is a set
 * of overrides applied on top of that config — pure, so the scene only ever
 * reads the result and nothing in it has to know a preset exists.
 *
 * `themeConfig.ts` says this axis belongs here rather than per route, because
 * the hour changes between rows on the same water while the water does not.
 */

export type Conditions = 'dawn' | 'midday' | 'golden' | 'overcast' | 'dusk';

/** Every preset, in the order they are offered. */
export const CONDITIONS: readonly Conditions[] = [
  'dawn',
  'midday',
  'golden',
  'overcast',
  'dusk',
] as const;

const LABELS: Record<Conditions, string> = {
  dawn: 'Dawn',
  midday: 'Midday',
  golden: 'Golden hour',
  overcast: 'Overcast',
  dusk: 'Dusk',
};

export const conditionsLabel = (condition: Conditions): string => LABELS[condition];

/**
 * The preset that matches an hour on the rower's own clock.
 *
 * The small hours are dawn rather than dusk: a rower on the water at four in
 * the morning is rowing towards the light, and an hour of 0 has to land
 * somewhere sensible rather than falling through to a default.
 */
export const conditionsForHour = (hour: number): Conditions => {
  if (hour < 7) return 'dawn';
  if (hour < 16) return 'midday';
  if (hour < 19) return 'golden';
  return 'dusk';
};

/**
 * Where the sun is, from one elevation and one azimuth.
 *
 * There used to be two suns. `sky.sunPosition` was authored as a vector and
 * `lighting.sunElevation`/`sunAzimuth` as angles, and they disagreed — the sky
 * drew its sun at [90, 55, 35] while the light shone from 45° at 135°, so
 * shadows fell one way and the glare came from another. Both are derived from
 * the same pair now, which is the unification #346 asks for.
 *
 * Azimuth is degrees clockwise from north, matching `LightingConfig`.
 */
export const sunPositionFrom = (
  elevationDeg: number,
  azimuthDeg: number,
  distance: number,
): [number, number, number] => {
  const elevation = (elevationDeg * Math.PI) / 180;
  const azimuth = (azimuthDeg * Math.PI) / 180;
  return [
    Math.cos(elevation) * Math.sin(azimuth) * distance,
    Math.sin(elevation) * distance,
    Math.cos(elevation) * Math.cos(azimuth) * distance,
  ];
};

/** How far out the sky's sun sits. Kept from the config it replaces. */
const SUN_DISTANCE = 110;

interface Preset {
  /** Degrees above the horizon. */
  elevation: number;
  /** Degrees clockwise from north: the sun tracks across as the day goes. */
  azimuth: number;
  sunColor: string;
  ambientColor: string;
  /** Multiplier on the config's own sun intensity. */
  sunIntensity: number;
  /** Multiplier on ambient, because a dim sun leaves a dark world otherwise. */
  ambientIntensity: number;
  /** Haze. A low sun looks through more air, so dawn and dusk are thicker. */
  turbidity: number;
  fogColor: string;
  /** Multiplier on how far the fog reaches. */
  fogFar: number;
  cloudCount: number;
  cloudOpacity: number;
}

const PRESETS: Record<Conditions, Preset> = {
  // Low, cold-warm and hazy: the sun is still coming up behind the far bank.
  dawn: {
    elevation: 8,
    azimuth: 95,
    sunColor: '#ffb47a',
    ambientColor: '#9fb8d8',
    sunIntensity: 0.7,
    ambientIntensity: 1.1,
    turbidity: 5.5,
    fogColor: '#c4d4e8',
    fogFar: 0.75,
    cloudCount: 6,
    cloudOpacity: 0.34,
  },
  midday: {
    elevation: 55,
    azimuth: 180,
    sunColor: '#fff4e0',
    ambientColor: '#b0d0e0',
    sunIntensity: 1,
    ambientIntensity: 1,
    turbidity: 3,
    fogColor: '#a8d0f0',
    fogFar: 1,
    cloudCount: 8,
    cloudOpacity: 0.38,
  },
  // The one rowers get up for: a long low light straight down the course.
  golden: {
    elevation: 12,
    azimuth: 255,
    sunColor: '#ffc37a',
    ambientColor: '#c8b4a8',
    sunIntensity: 0.9,
    ambientIntensity: 0.95,
    turbidity: 4.5,
    fogColor: '#e0c8b0',
    fogFar: 0.85,
    cloudCount: 7,
    cloudOpacity: 0.42,
  },
  /**
   * The weather preset rather than an hour: a flatter, dimmer, closer world.
   *
   * The sun stays high — an overcast sky is bright and directionless, not
   * dark — but it is dimmed hard and the fog is pulled in, because what
   * actually reads as overcast is the far bank going soft.
   */
  overcast: {
    elevation: 40,
    azimuth: 180,
    sunColor: '#d8dde3',
    ambientColor: '#c0c8d0',
    sunIntensity: 0.45,
    ambientIntensity: 1.35,
    turbidity: 9,
    fogColor: '#c8d2da',
    fogFar: 0.5,
    cloudCount: 16,
    cloudOpacity: 0.9,
  },
  dusk: {
    elevation: 4,
    azimuth: 280,
    sunColor: '#ff9a5a',
    ambientColor: '#6a7a9a',
    sunIntensity: 0.5,
    ambientIntensity: 0.9,
    turbidity: 6.5,
    fogColor: '#8a90b0',
    fogFar: 0.7,
    cloudCount: 5,
    cloudOpacity: 0.45,
  },
};

/**
 * `SCENE_CONFIG` as it looks under a given preset.
 *
 * Returns a new config; the one passed in is never touched, because it is a
 * module-level singleton that every other part of the scene reads.
 */
export const applyConditions = (config: SceneConfig, condition: Conditions): SceneConfig => {
  const preset = PRESETS[condition];

  return {
    ...config,
    lighting: {
      ...config.lighting,
      sunElevation: preset.elevation,
      sunAzimuth: preset.azimuth,
      sunColor: preset.sunColor,
      sunIntensity: config.lighting.sunIntensity * preset.sunIntensity,
      ambientColor: preset.ambientColor,
      ambientIntensity: config.lighting.ambientIntensity * preset.ambientIntensity,
    },
    sky: {
      ...config.sky,
      // The one sun: the sky's and the light's, from the same two angles.
      sunPosition: sunPositionFrom(preset.elevation, preset.azimuth, SUN_DISTANCE),
      turbidity: preset.turbidity,
    },
    clouds: {
      ...config.clouds,
      // Whole clouds: `count` is how many meshes are built.
      count: Math.round(preset.cloudCount),
      opacity: preset.cloudOpacity,
    },
    atmosphere: {
      ...config.atmosphere,
      fogColor: preset.fogColor,
      fogFar: config.atmosphere.fogFar * preset.fogFar,
    },
  };
};
