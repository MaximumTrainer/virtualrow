// ============================================================================
// SCENE_CONFIG — the scene's art direction, in one object.
//
//   water · bank · landscapeColors · atmosphere · sky · clouds · lighting
//   colorGrading · trees · architecture · groundCover · horizon
//
// There used to be six of these, one per route theme, and a theme key
// threaded through the scene to choose between them. #361 retired five and
// #364 removed the choosing: every section here is read directly by the part
// of the scene it dresses.
//
// Time of day and weather (#346) vary within a row rather than per route, so
// whatever selects between presets for them belongs on that axis, added with
// the shape it turns out to need.
// ============================================================================

// ---------------------------------------------------------------------------
// Per-section config interfaces
// ---------------------------------------------------------------------------

export interface WaterConfig {
  color: string;
  transmission: number;
  roughness: number;
  thickness: number;
  emissive: string;
  emissiveIntensity: number;
  attenuationColor: string;
  attenuationDistance: number;
  specularIntensity: number;
  sheenColor: string;
  /** Multiplier on Gerstner wave height (0.5–2.0) */
  waveAmplitude: number;
  /** Multiplier on Gerstner wave frequency (0.5–2.0) */
  waveFrequency: number;
  /** 0–1: blade-entry foam opacity ceiling */
  foamIntensity: number;
  /**
   * Hex colour of the wake and the blade-entry foam.
   *
   * Passed through `bloomSafeFoamColor` before it reaches a material, so a
   * theme can author the colour it wants without having to know where the
   * bloom pass's threshold sits (#323).
   */
  foamColor: string;
}


/** PBR material properties used by CurvedRiverbanks */
export interface BankConfig {
  color: string;
  roughness: number;
  metalness: number;
  emissive: string;
  emissiveIntensity: number;
  sheen: number;
  sheenColor: string;
  /** Simple flat colour used by ThemedRiverbanks */
  flatColor: string;
}

export interface LandscapeColors {
  tree: string;
  treeBark: string;
  treeHighlight: string;
  mountain: string;
  mountainSnow: string;
  buildingAccent: string;
  windowGlow: string;
}

export interface AtmosphereConfig {
  fogColor: string;
  fogNear: number;
  fogFar: number;
}

export interface SkyConfig {
  sunPosition: [number, number, number];
  turbidity: number;
  rayleigh: number;
  mieCoefficient: number;
  mieDirectionalG: number;
  exposure: number;
}

export interface CloudConfig {
  enabled: boolean;
  count: number;
  opacity: number;
  speed: number;
  color: string;
  segments: number;
  scale: number;
  depth: number;
}


export interface LightingConfig {
  ambientColor: string;
  ambientIntensity: number;
  sunColor: string;
  sunIntensity: number;
  fillColor: string;
  fillIntensity: number;
  /** Degrees above horizon (0–90) */
  sunElevation: number;
  /** Degrees; 0=north, 90=east, 180=south, 270=west */
  sunAzimuth: number;
}

export interface ColorGradingConfig {
  hue: number;
  saturation: number;
  brightness: number;
  contrast: number;
}

// ---------------------------------------------------------------------------
// Phase 6 scene-enrichment config sections (#128, #129, #130, #131)
// ---------------------------------------------------------------------------

export interface TreeSpeciesEntry {
  type: 'pine' | 'willow' | 'oak' | 'cypress' | 'palm' | 'bare' | 'ornamental';
  color: string;
  trunkColor: string;
}

export interface TreesConfig {
  species: TreeSpeciesEntry[];
}

export interface ArchitectureConfig {
  wallMaterial: { color: string; roughness: number };
  roofColor: string;
}

export interface GroundCoverTypeEntry {
  type: 'reed' | 'rock' | 'grass' | 'flower' | 'debris';
  color: string;
  /** Scale multiplier */
  scale: number;
}

export interface GroundCoverConfig {
  types: GroundCoverTypeEntry[];
}

/** A rolling line of hills: the only horizon left since #361 (#364). */
export interface HorizonConfig {
  /** Silhouette fill color */
  color: string;
  /** Z distance from boat */
  distance: number;
  /** Max height of silhouette in scene units */
  height: number;
}

export interface SceneConfig {
  water: WaterConfig;
  bank: BankConfig;
  landscapeColors: LandscapeColors;
  atmosphere: AtmosphereConfig;
  sky: SkyConfig;
  clouds: CloudConfig;
  lighting: LightingConfig;
  colorGrading: ColorGradingConfig;
  trees: TreesConfig;
  architecture: ArchitectureConfig;
  groundCover: GroundCoverConfig;
  horizon: HorizonConfig;
}

export const SCENE_CONFIG: SceneConfig = {
  water: {
    color: '#3a5a55', transmission: 0.38, roughness: 0.10, thickness: 2.5,
    emissive: '#2a4a40', emissiveIntensity: 0.008, attenuationColor: '#2a4a45',
    attenuationDistance: 4.0, specularIntensity: 0.9, sheenColor: '#4a6a60',
    waveAmplitude: 1.0, waveFrequency: 1.0,
    foamIntensity: 0.35, foamColor: '#dfe9ee',
  },
  bank: {
    color: '#4a7a32', roughness: 0.9, metalness: 0.0,
    emissive: '#2a4a18', emissiveIntensity: 0.006, sheen: 0.3, sheenColor: '#6a9a52',
    flatColor: '#4a7c32',
  },
  landscapeColors: {
    tree: '#2a5a38', treeBark: '#4a3020', treeHighlight: '#4a8a58',
    mountain: '#5a7247', mountainSnow: '#f5f8fa',
    buildingAccent: '#6a5a45', windowGlow: '#ffcc88',
  },
  atmosphere: {
    // Metres, since #321. 60/600 was authored when a unit was ten of them,
    // so the fade began at 600 m and closed six kilometres out - which is to
    // say never, on any water a rower can see across (#325).
    fogColor: '#a8d0f0', fogNear: 80, fogFar: 550,
  },
  sky: {
    sunPosition: [90, 55, 35], turbidity: 3.5, rayleigh: 2.8,
    mieCoefficient: 0.008, mieDirectionalG: 0.82,
    exposure: 0.42,
  },
  clouds: {
    enabled: true, count: 8, opacity: 0.38, speed: 0.16,
    color: '#f8f8ff', segments: 28, scale: 1.1, depth: 0.85,
  },
  lighting: {
    ambientColor: '#b0d0e0', ambientIntensity: 0.25,
    sunColor: '#fff8e8', sunIntensity: 1.2,
    fillColor: '#b4c7dc', fillIntensity: 0.3,
    sunElevation: 45, sunAzimuth: 135,
  },
  colorGrading: { hue: 0, saturation: 0.1, brightness: 0, contrast: 0.05 },
  trees: {
    species: [
      { type: 'willow', color: '#3a6840', trunkColor: '#5a4030' },
      { type: 'oak',    color: '#2a5838', trunkColor: '#4a3820' },
      // The billboard foliage draws a conifer shape (#333); without a pine
      // here a forest profile could only ever plant broadleaves.
      { type: 'pine',   color: '#24472e', trunkColor: '#3a2a1a' },
    ],
  },
  architecture: {
    wallMaterial: { color: '#8b4a3a', roughness: 0.88 },
    roofColor: '#4a4a5a',
  },
  groundCover: {
    types: [
      { type: 'reed',   color: '#4a6a38', scale: 0.7 },
      { type: 'flower', color: '#c8a8d0', scale: 0.3 },
      { type: 'grass',  color: '#4a7a32', scale: 0.5 },
    ],
  },
  horizon: { color: '#7a9a5a', distance: 350, height: 40 },
};
