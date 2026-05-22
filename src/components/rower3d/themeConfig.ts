// ============================================================================
// THEME_CONFIG — single source of truth for all per-theme visual settings.
// Eliminates 8+ parallel switch(theme) blocks scattered across Rower3D.tsx.
//
// Each RouteTheme key maps to a ThemeConfig object that covers:
//   water · mist · bank · landscapeColors · atmosphere · sky · clouds
// ============================================================================

export type RouteTheme =
  | 'willowbrook'
  | 'crystal-bled'
  | 'gothic-venice'
  | 'steampunk-henley'
  | 'dystopian-thames'
  | 'scifi-boston';

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
}

export interface MistConfig {
  baseOpacity: number;
  color1: string;
  color2: string;
  height1: number;
  height2: number;
  density: number;
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

export interface ThemeConfig {
  water: WaterConfig;
  mist: MistConfig;
  bank: BankConfig;
  landscapeColors: LandscapeColors;
  atmosphere: AtmosphereConfig;
  sky: SkyConfig;
  clouds: CloudConfig;
}

// ---------------------------------------------------------------------------
// THEME_CONFIG record — one entry per RouteTheme
// ---------------------------------------------------------------------------

export const THEME_CONFIG: Record<RouteTheme, ThemeConfig> = {
  'crystal-bled': {
    water: {
      color: '#3a9db8', transmission: 0.65, roughness: 0.04, thickness: 3.5,
      emissive: '#00e5ff', emissiveIntensity: 0.06, attenuationColor: '#00a8cc',
      attenuationDistance: 8.0, specularIntensity: 1.2, sheenColor: '#80deea',
    },
    mist: {
      baseOpacity: 0.06, color1: '#e8f4f8', color2: '#d0e8f0',
      height1: 0.3, height2: 1.5, density: 0.5,
    },
    bank: {
      color: '#5a8a42', roughness: 0.88, metalness: 0.0,
      emissive: '#2a4a22', emissiveIntensity: 0.01, sheen: 0.25, sheenColor: '#7ab05a',
      flatColor: '#2d5a27',
    },
    landscapeColors: {
      tree: '#2a5a38', treeBark: '#4a3020', treeHighlight: '#4a8a58',
      mountain: '#5a7247', mountainSnow: '#f8faff',
      building: '#8fa4b8', buildingAccent: '#6a8098', windowGlow: '#e8f4ff',
    },
    atmosphere: {
      fogColor: '#b0ddfa', fogNear: 80, fogFar: 800,
      skyColor: '#87ceeb', ambientColor: '#c0e0ff', ambientIntensity: 0.45,
    },
    sky: {
      sunPosition: [120, 100, 60], turbidity: 1.2, rayleigh: 2.2,
      mieCoefficient: 0.003, mieDirectionalG: 0.75,
      inclination: 0.70, azimuth: 0.25, exposure: 0.55,
      sunIntensity: 2.2, sunColor: '#fffaf0',
    },
    clouds: {
      enabled: true, count: 5, opacity: 0.42, speed: 0.18,
      color: '#ffffff', segments: 32, scale: 1.3, depth: 0.8,
    },
  },

  'gothic-venice': {
    water: {
      color: '#1e3a3a', transmission: 0.22, roughness: 0.18, thickness: 1.5,
      emissive: '#0a3d62', emissiveIntensity: 0.015, attenuationColor: '#1a2f2f',
      attenuationDistance: 2.0, specularIntensity: 0.6, sheenColor: '#2a4a4a',
    },
    mist: {
      baseOpacity: 0.22, color1: '#1e272e', color2: '#2a3a4a',
      height1: 0.6, height2: 2.5, density: 1.4,
    },
    bank: {
      color: '#2a3a2a', roughness: 0.95, metalness: 0.02,
      emissive: '#1a2a1a', emissiveIntensity: 0.005, sheen: 0.1, sheenColor: '#3a4a3a',
      flatColor: '#1e272e',
    },
    landscapeColors: {
      tree: '#1a2818', treeBark: '#2a1810', treeHighlight: '#2a3a28',
      mountain: '#3d4a3a', mountainSnow: '#c0c8d0',
      building: '#3a4552', buildingAccent: '#2a3542', windowGlow: '#ff8844',
    },
    atmosphere: {
      fogColor: '#2a3a4a', fogNear: 15, fogFar: 250,
      skyColor: '#1e272e', ambientColor: '#4a5a6a', ambientIntensity: 0.25,
    },
    sky: {
      sunPosition: [40, 12, -120], turbidity: 12, rayleigh: 3.5,
      mieCoefficient: 0.06, mieDirectionalG: 0.96,
      inclination: 0.32, azimuth: 0.78, exposure: 0.28,
      sunIntensity: 0.8, sunColor: '#ff9966',
    },
    clouds: {
      enabled: true, count: 14, opacity: 0.65, speed: 0.06,
      color: '#5a6268', segments: 38, scale: 1.5, depth: 1.2,
    },
  },

  'steampunk-henley': {
    water: {
      color: '#3a4a38', transmission: 0.28, roughness: 0.15, thickness: 2.0,
      emissive: '#4a6741', emissiveIntensity: 0.008, attenuationColor: '#3a4a38',
      attenuationDistance: 3.0, specularIntensity: 0.8, sheenColor: '#5a7a58',
    },
    mist: {
      baseOpacity: 0.14, color1: '#8b7355', color2: '#a08565',
      height1: 0.8, height2: 2.0, density: 0.9,
    },
    bank: {
      color: '#6a7a48', roughness: 0.82, metalness: 0.0,
      emissive: '#4a5a30', emissiveIntensity: 0.008, sheen: 0.35, sheenColor: '#8a9a68',
      flatColor: '#5d4e37',
    },
    landscapeColors: {
      tree: '#4a5a3a', treeBark: '#5a4030', treeHighlight: '#6a7a5a',
      mountain: '#8b7355', mountainSnow: '#e8dcd0',
      building: '#c49a32', buildingAccent: '#8b6914', windowGlow: '#ffcc44',
    },
    atmosphere: {
      fogColor: '#9a8365', fogNear: 35, fogFar: 450,
      skyColor: '#d4a857', ambientColor: '#c9a227', ambientIntensity: 0.4,
    },
    sky: {
      sunPosition: [90, 28, 70], turbidity: 9, rayleigh: 1.4,
      mieCoefficient: 0.035, mieDirectionalG: 0.92,
      inclination: 0.40, azimuth: 0.12, exposure: 0.48,
      sunIntensity: 1.6, sunColor: '#ffcc66',
    },
    clouds: {
      enabled: true, count: 9, opacity: 0.48, speed: 0.12,
      color: '#f0e0c8', segments: 30, scale: 1.2, depth: 0.9,
    },
  },

  'dystopian-thames': {
    water: {
      color: '#0a1a2a', transmission: 0.15, roughness: 0.22, thickness: 1.0,
      emissive: '#1a2a4a', emissiveIntensity: 0.025, attenuationColor: '#0a1520',
      attenuationDistance: 1.0, specularIntensity: 1.4, sheenColor: '#2a3a5a',
    },
    mist: {
      baseOpacity: 0.18, color1: '#1a1a2e', color2: '#2a2a3e',
      height1: 0.5, height2: 3.0, density: 1.2,
    },
    bank: {
      color: '#1a1a18', roughness: 0.96, metalness: 0.05,
      emissive: '#0a0a08', emissiveIntensity: 0.002, sheen: 0.05, sheenColor: '#2a2a28',
      flatColor: '#1a1a2e',
    },
    landscapeColors: {
      tree: '#151512', treeBark: '#1a1510', treeHighlight: '#252520',
      mountain: '#2a2a2a', mountainSnow: '#4a4a4a',
      building: '#3a3a3a', buildingAccent: '#2a2a2a', windowGlow: '#ff4422',
    },
    atmosphere: {
      fogColor: '#1a1a28', fogNear: 20, fogFar: 300,
      skyColor: '#0f172a', ambientColor: '#2a2a3a', ambientIntensity: 0.2,
    },
    sky: {
      sunPosition: [25, 6, -90], turbidity: 20, rayleigh: 0.4,
      mieCoefficient: 0.12, mieDirectionalG: 0.99,
      inclination: 0.25, azimuth: 0.88, exposure: 0.22,
      sunIntensity: 0.5, sunColor: '#ff6633',
    },
    clouds: {
      enabled: true, count: 16, opacity: 0.72, speed: 0.04,
      color: '#3a3a42', segments: 42, scale: 1.6, depth: 1.4,
    },
  },

  'scifi-boston': {
    water: {
      color: '#0a3a4a', transmission: 0.45, roughness: 0.06, thickness: 2.5,
      emissive: '#00ced1', emissiveIntensity: 0.12, attenuationColor: '#006080',
      attenuationDistance: 5.0, specularIntensity: 1.0, sheenColor: '#40e0d0',
    },
    mist: {
      baseOpacity: 0.08, color1: '#162447', color2: '#1a3a5a',
      height1: 0.4, height2: 2.0, density: 0.7,
    },
    bank: {
      color: '#1a2a3a', roughness: 0.75, metalness: 0.15,
      emissive: '#0a1a2a', emissiveIntensity: 0.015, sheen: 0.2, sheenColor: '#2a4a5a',
      flatColor: '#0f172a',
    },
    landscapeColors: {
      tree: '#152a20', treeBark: '#1a2018', treeHighlight: '#2a4a3a',
      mountain: '#2a3a4a', mountainSnow: '#4a6a8a',
      building: '#3a5a7a', buildingAccent: '#2a4a6a', windowGlow: '#00e0ff',
    },
    atmosphere: {
      fogColor: '#0a1428', fogNear: 50, fogFar: 550,
      skyColor: '#162447', ambientColor: '#1a3a5a', ambientIntensity: 0.3,
    },
    sky: {
      sunPosition: [-60, 70, 120], turbidity: 0.4, rayleigh: 0.15,
      mieCoefficient: 0.0008, mieDirectionalG: 0.65,
      inclination: 0.62, azimuth: 0.55, exposure: 0.18,
      sunIntensity: 0.6, sunColor: '#aaccff',
    },
    clouds: {
      enabled: true, count: 3, opacity: 0.22, speed: 0.28,
      color: '#2a4a6a', segments: 22, scale: 0.9, depth: 0.6,
    },
  },

  'willowbrook': {
    water: {
      color: '#3a5a55', transmission: 0.38, roughness: 0.10, thickness: 2.5,
      emissive: '#2a4a40', emissiveIntensity: 0.008, attenuationColor: '#2a4a45',
      attenuationDistance: 4.0, specularIntensity: 0.9, sheenColor: '#4a6a60',
    },
    mist: {
      baseOpacity: 0.10, color1: '#c8d4dc', color2: '#d8e4ec',
      height1: 0.5, height2: 1.8, density: 0.8,
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
      fogColor: '#a8d0f0', fogNear: 60, fogFar: 600,
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
  },
};

/** Convenience accessor — returns the full config for the given theme. */
export function getThemeConfig(theme: RouteTheme): ThemeConfig {
  return THEME_CONFIG[theme] ?? THEME_CONFIG['willowbrook'];
}
