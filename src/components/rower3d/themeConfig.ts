// ============================================================================
// THEME_CONFIG — single source of truth for all per-theme visual settings.
// Eliminates 8+ parallel switch(theme) blocks scattered across Rower3D.tsx.
//
// Each RouteTheme key maps to a ThemeConfig object that covers:
//   water · bank · landscapeColors · atmosphere · sky · clouds
//   trees · architecture · groundCover · horizon
// ============================================================================

/**
 * The themes a route can be dressed in (#361).
 *
 * One, since the other five were retired: fantasy reskins nothing reached, two
 * of which rendered very nearly black, and which between them intercepted the
 * Tideway, the Charles and Henley Reach by matching their names.
 *
 * Kept as a named type rather than dissolved into the scene because the shape
 * below is the scene's art direction, read by the bank, sky, clouds, horizon,
 * water, vegetation, colour grading and exposure alike - and #346 wants that
 * same shape on a different axis.
 */
export type RouteTheme = 'willowbrook';

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
  /** 0–1: affects murk/depth colour under water */
  turbidity: number;
  /** Multiplier on Gerstner wave height (0.5–2.0) */
  waveAmplitude: number;
  /** Multiplier on Gerstner wave frequency (0.5–2.0) */
  waveFrequency: number;
  /** 0–1: blade-entry foam opacity ceiling */
  foamIntensity: number;
  /** Hex colour used for underwater murk tint */
  underwaterFog: string;
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
  building: string;
  buildingAccent: string;
  windowGlow: string;
}

export interface AtmosphereConfig {
  fogColor: string;
  fogNear: number;
  fogFar: number;
  skyColor: string;
  ambientColor: string;
  ambientIntensity: number;
}

export interface SkyConfig {
  sunPosition: [number, number, number];
  turbidity: number;
  rayleigh: number;
  mieCoefficient: number;
  mieDirectionalG: number;
  inclination: number;
  azimuth: number;
  exposure: number;
  sunIntensity: number;
  sunColor: string;
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
  /** [min, max] height in scene units */
  heightRange: [number, number];
  /** [min, max] crown radius in scene units */
  radiusRange: [number, number];
  /** Relative density weight 0–1 */
  density: number;
}

export interface TreesConfig {
  species: TreeSpeciesEntry[];
}

export interface ArchitectureConfig {
  buildingStyle: 'georgian' | 'gothic' | 'canal' | 'industrial' | 'modern' | 'futuristic';
  wallMaterial: { color: string; roughness: number };
  roofStyle: 'flat' | 'gabled' | 'pointed' | 'dome';
  roofColor: string;
  hasBridges: boolean;
  bridgeStyle: 'stone-arch' | 'iron-truss' | 'gondola-bridge' | 'modern-cable';
}

export interface GroundCoverTypeEntry {
  type: 'reed' | 'rock' | 'grass' | 'flower' | 'debris';
  color: string;
  /** Relative density weight 0–1 */
  density: number;
  /** Scale multiplier */
  scale: number;
}

export interface GroundCoverConfig {
  types: GroundCoverTypeEntry[];
}

export interface HorizonConfig {
  type: 'mountains' | 'city' | 'hills' | 'industrial' | 'islands';
  /** Silhouette fill color */
  color: string;
  /** Z distance from boat */
  distance: number;
  /** Max height of silhouette in scene units */
  height: number;
}

/**
 * Where a theme's landscape comes from.
 *
 * `glb-kit` themes are dressed from the shared scenery catalogue, so any route
 * wearing one can show the models. `bespoke` themes ship their own scene
 * (CrystalBledScene and friends) and must not have the kit layered on top.
 *
 * This replaces the old `routeTheme === 'willowbrook'` test, which admitted a
 * single theme by name and silently excluded every real course whose name
 * matched a stylised theme (issue #232).
 */
export type LandscapeSource = 'glb-kit' | 'bespoke';

export interface ThemeConfig {
  landscapeSource: LandscapeSource;
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

// ---------------------------------------------------------------------------
// THEME_CONFIG record — one entry per RouteTheme
// ---------------------------------------------------------------------------

export const THEME_CONFIG: Record<RouteTheme, ThemeConfig> = {





  'willowbrook': {
    landscapeSource: 'glb-kit',
    water: {
      color: '#3a5a55', transmission: 0.38, roughness: 0.10, thickness: 2.5,
      emissive: '#2a4a40', emissiveIntensity: 0.008, attenuationColor: '#2a4a45',
      attenuationDistance: 4.0, specularIntensity: 0.9, sheenColor: '#4a6a60',
      turbidity: 0.3, waveAmplitude: 1.0, waveFrequency: 1.0,
      foamIntensity: 0.35, underwaterFog: '#2a4a40',
    },
    bank: {
      color: '#4a7a32', roughness: 0.9, metalness: 0.0,
      emissive: '#2a4a18', emissiveIntensity: 0.006, sheen: 0.3, sheenColor: '#6a9a52',
      flatColor: '#4a7c32',
    },
    landscapeColors: {
      tree: '#2a5a38', treeBark: '#4a3020', treeHighlight: '#4a8a58',
      mountain: '#5a7247', mountainSnow: '#f5f8fa',
      building: '#8b7355', buildingAccent: '#6a5a45', windowGlow: '#ffcc88',
    },
    atmosphere: {
      // Metres, since #321. 60/600 was authored when a unit was ten of them,
      // so the fade began at 600 m and closed six kilometres out - which is to
      // say never, on any water a rower can see across (#325).
      fogColor: '#a8d0f0', fogNear: 80, fogFar: 550,
      skyColor: '#a0cdfa', ambientColor: '#b0d0e0', ambientIntensity: 0.38,
    },
    sky: {
      sunPosition: [90, 55, 35], turbidity: 3.5, rayleigh: 2.8,
      mieCoefficient: 0.008, mieDirectionalG: 0.82,
      inclination: 0.58, azimuth: 0.18, exposure: 0.42,
      sunIntensity: 1.8, sunColor: '#fff8e8',
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
        { type: 'willow', color: '#3a6840', trunkColor: '#5a4030', heightRange: [7, 15],  radiusRange: [2.5, 5.0], density: 0.5 },
        { type: 'oak',    color: '#2a5838', trunkColor: '#4a3820', heightRange: [6, 13],  radiusRange: [2.0, 4.5], density: 0.5 },
      ],
    },
    architecture: {
      buildingStyle: 'georgian',
      wallMaterial: { color: '#8b4a3a', roughness: 0.88 },
      roofStyle: 'gabled',
      roofColor: '#4a4a5a',
      hasBridges: false,
      bridgeStyle: 'stone-arch',
    },
    groundCover: {
      types: [
        { type: 'reed',   color: '#4a6a38', density: 0.5, scale: 0.7 },
        { type: 'flower', color: '#c8a8d0', density: 0.4, scale: 0.3 },
        { type: 'grass',  color: '#4a7a32', density: 0.6, scale: 0.5 },
      ],
    },
    horizon: { type: 'hills', color: '#7a9a5a', distance: 350, height: 40 },
  },
};

/** Convenience accessor — returns the full config for the given theme. */
export function getThemeConfig(theme: RouteTheme): ThemeConfig {
  return THEME_CONFIG[theme];
}

/** Whether this theme is dressed from the shared GLB scenery catalogue. */
export const themeUsesGlbScenery = (theme: RouteTheme): boolean =>
  getThemeConfig(theme).landscapeSource === 'glb-kit';
