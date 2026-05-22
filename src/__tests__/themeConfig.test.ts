import { describe, it, expect } from 'vitest';
import {
  THEME_CONFIG,
  getThemeConfig,
  type RouteTheme,
} from '../components/rower3d/themeConfig';

const ALL_THEMES: RouteTheme[] = [
  'willowbrook',
  'crystal-bled',
  'gothic-venice',
  'steampunk-henley',
  'dystopian-thames',
  'scifi-boston',
];

describe('THEME_CONFIG', () => {
  it('has an entry for every RouteTheme', () => {
    for (const theme of ALL_THEMES) {
      expect(THEME_CONFIG[theme]).toBeDefined();
    }
  });

  it('every entry has all required top-level sections', () => {
    for (const theme of ALL_THEMES) {
      const cfg = THEME_CONFIG[theme];
      expect(cfg).toHaveProperty('water');
      expect(cfg).toHaveProperty('mist');
      expect(cfg).toHaveProperty('bank');
      expect(cfg).toHaveProperty('landscapeColors');
      expect(cfg).toHaveProperty('atmosphere');
      expect(cfg).toHaveProperty('sky');
      expect(cfg).toHaveProperty('clouds');
      expect(cfg).toHaveProperty('fog');
      expect(cfg).toHaveProperty('lighting');
      expect(cfg).toHaveProperty('colorGrading');
      expect(cfg).toHaveProperty('trees');
      expect(cfg).toHaveProperty('architecture');
      expect(cfg).toHaveProperty('groundCover');
      expect(cfg).toHaveProperty('horizon');
    }
  });

  it('water configs have all required fields', () => {
    for (const theme of ALL_THEMES) {
      const w = THEME_CONFIG[theme].water;
      expect(typeof w.color).toBe('string');
      expect(typeof w.transmission).toBe('number');
      expect(typeof w.roughness).toBe('number');
      expect(typeof w.thickness).toBe('number');
      expect(typeof w.emissive).toBe('string');
      expect(typeof w.emissiveIntensity).toBe('number');
      expect(typeof w.attenuationColor).toBe('string');
      expect(typeof w.attenuationDistance).toBe('number');
      expect(typeof w.specularIntensity).toBe('number');
      expect(typeof w.sheenColor).toBe('string');
      // Phase 6 water character fields (#127)
      expect(typeof w.turbidity).toBe('number');
      expect(w.turbidity).toBeGreaterThanOrEqual(0);
      expect(w.turbidity).toBeLessThanOrEqual(1);
      expect(typeof w.waveAmplitude).toBe('number');
      expect(w.waveAmplitude).toBeGreaterThan(0);
      expect(typeof w.waveFrequency).toBe('number');
      expect(w.waveFrequency).toBeGreaterThan(0);
      expect(typeof w.foamIntensity).toBe('number');
      expect(w.foamIntensity).toBeGreaterThanOrEqual(0);
      expect(w.foamIntensity).toBeLessThanOrEqual(1);
      expect(typeof w.underwaterFog).toBe('string');
    }
  });

  it('mist configs have all required fields', () => {
    for (const theme of ALL_THEMES) {
      const m = THEME_CONFIG[theme].mist;
      expect(typeof m.baseOpacity).toBe('number');
      expect(typeof m.color1).toBe('string');
      expect(typeof m.color2).toBe('string');
      expect(typeof m.height1).toBe('number');
      expect(typeof m.height2).toBe('number');
      expect(typeof m.density).toBe('number');
    }
  });

  it('bank configs have all required fields', () => {
    for (const theme of ALL_THEMES) {
      const b = THEME_CONFIG[theme].bank;
      expect(typeof b.color).toBe('string');
      expect(typeof b.roughness).toBe('number');
      expect(typeof b.metalness).toBe('number');
      expect(typeof b.emissive).toBe('string');
      expect(typeof b.emissiveIntensity).toBe('number');
      expect(typeof b.sheen).toBe('number');
      expect(typeof b.sheenColor).toBe('string');
      expect(typeof b.flatColor).toBe('string');
    }
  });

  it('landscapeColors have all required fields', () => {
    for (const theme of ALL_THEMES) {
      const lc = THEME_CONFIG[theme].landscapeColors;
      expect(typeof lc.tree).toBe('string');
      expect(typeof lc.treeBark).toBe('string');
      expect(typeof lc.treeHighlight).toBe('string');
      expect(typeof lc.mountain).toBe('string');
      expect(typeof lc.mountainSnow).toBe('string');
      expect(typeof lc.building).toBe('string');
      expect(typeof lc.buildingAccent).toBe('string');
      expect(typeof lc.windowGlow).toBe('string');
    }
  });

  it('atmosphere configs have all required fields', () => {
    for (const theme of ALL_THEMES) {
      const a = THEME_CONFIG[theme].atmosphere;
      expect(typeof a.fogColor).toBe('string');
      expect(typeof a.fogNear).toBe('number');
      expect(typeof a.fogFar).toBe('number');
      expect(typeof a.skyColor).toBe('string');
      expect(typeof a.ambientColor).toBe('string');
      expect(typeof a.ambientIntensity).toBe('number');
    }
  });

  it('sky configs have all required fields with valid ranges', () => {
    for (const theme of ALL_THEMES) {
      const sky = THEME_CONFIG[theme].sky;
      expect(Array.isArray(sky.sunPosition)).toBe(true);
      expect(sky.sunPosition).toHaveLength(3);
      expect(typeof sky.turbidity).toBe('number');
      expect(sky.turbidity).toBeGreaterThanOrEqual(0);
      expect(typeof sky.rayleigh).toBe('number');
      expect(typeof sky.mieCoefficient).toBe('number');
      expect(typeof sky.mieDirectionalG).toBe('number');
      expect(sky.mieDirectionalG).toBeGreaterThanOrEqual(0);
      expect(sky.mieDirectionalG).toBeLessThanOrEqual(1);
      expect(typeof sky.exposure).toBe('number');
      expect(typeof sky.sunIntensity).toBe('number');
      expect(typeof sky.sunColor).toBe('string');
    }
  });

  it('cloud configs have all required fields', () => {
    for (const theme of ALL_THEMES) {
      const clouds = THEME_CONFIG[theme].clouds;
      expect(typeof clouds.enabled).toBe('boolean');
      expect(typeof clouds.count).toBe('number');
      expect(clouds.count).toBeGreaterThan(0);
      expect(typeof clouds.opacity).toBe('number');
      expect(clouds.opacity).toBeGreaterThanOrEqual(0);
      expect(clouds.opacity).toBeLessThanOrEqual(1);
      expect(typeof clouds.speed).toBe('number');
      expect(typeof clouds.color).toBe('string');
      expect(typeof clouds.segments).toBe('number');
      expect(typeof clouds.scale).toBe('number');
      expect(typeof clouds.depth).toBe('number');
    }
  });

  it('fog configs have color and positive density (#108)', () => {
    for (const theme of ALL_THEMES) {
      const fog = THEME_CONFIG[theme].fog;
      expect(typeof fog.color).toBe('string');
      expect(typeof fog.density).toBe('number');
      expect(fog.density).toBeGreaterThan(0);
    }
  });

  it('lighting configs have all required fields with valid ranges (#108)', () => {
    for (const theme of ALL_THEMES) {
      const l = THEME_CONFIG[theme].lighting;
      expect(typeof l.ambientColor).toBe('string');
      expect(typeof l.ambientIntensity).toBe('number');
      expect(l.ambientIntensity).toBeGreaterThanOrEqual(0);
      expect(typeof l.sunColor).toBe('string');
      expect(typeof l.sunIntensity).toBe('number');
      expect(l.sunIntensity).toBeGreaterThanOrEqual(0);
      expect(typeof l.fillColor).toBe('string');
      expect(typeof l.fillIntensity).toBe('number');
      expect(l.fillIntensity).toBeGreaterThanOrEqual(0);
      // Phase 6 per-theme lighting profiles (#126)
      expect(typeof l.sunElevation).toBe('number');
      expect(l.sunElevation).toBeGreaterThanOrEqual(0);
      expect(l.sunElevation).toBeLessThanOrEqual(90);
      expect(typeof l.sunAzimuth).toBe('number');
      expect(l.sunAzimuth).toBeGreaterThanOrEqual(0);
      expect(l.sunAzimuth).toBeLessThan(360);
    }
  });

  it('colorGrading configs have all required fields with valid ranges (#124)', () => {
    for (const theme of ALL_THEMES) {
      const cg = THEME_CONFIG[theme].colorGrading;
      expect(typeof cg.hue).toBe('number');
      expect(cg.hue).toBeGreaterThanOrEqual(-0.5);
      expect(cg.hue).toBeLessThanOrEqual(0.5);
      expect(typeof cg.saturation).toBe('number');
      expect(cg.saturation).toBeGreaterThanOrEqual(-1);
      expect(cg.saturation).toBeLessThanOrEqual(1);
      expect(typeof cg.brightness).toBe('number');
      expect(cg.brightness).toBeGreaterThanOrEqual(-1);
      expect(cg.brightness).toBeLessThanOrEqual(1);
      expect(typeof cg.contrast).toBe('number');
      expect(cg.contrast).toBeGreaterThanOrEqual(-1);
      expect(cg.contrast).toBeLessThanOrEqual(1);
    }
  });

  it('dark themes have denser fog than bright themes', () => {
    expect(THEME_CONFIG['dystopian-thames'].fog.density).toBeGreaterThan(
      THEME_CONFIG['crystal-bled'].fog.density,
    );
    expect(THEME_CONFIG['gothic-venice'].fog.density).toBeGreaterThan(
      THEME_CONFIG['willowbrook'].fog.density,
    );
  });

  it('themes are visually distinct (water colors differ)', () => {
    const waterColors = ALL_THEMES.map((t) => THEME_CONFIG[t].water.color);
    const unique = new Set(waterColors);
    expect(unique.size).toBe(ALL_THEMES.length);
  });
});

describe('getThemeConfig', () => {
  it('returns the correct config for each known theme', () => {
    for (const theme of ALL_THEMES) {
      expect(getThemeConfig(theme)).toBe(THEME_CONFIG[theme]);
    }
  });

  it('falls back to willowbrook for an unknown theme', () => {
    const fallback = getThemeConfig('unknown-theme' as RouteTheme);
    expect(fallback).toBe(THEME_CONFIG['willowbrook']);
  });

  it('crystal-bled has high water transmission (clear alpine lake)', () => {
    expect(getThemeConfig('crystal-bled').water.transmission).toBeGreaterThan(0.5);
  });

  it('crystal-bled has low turbidity (clearest water)', () => {
    const bled = getThemeConfig('crystal-bled').water.turbidity;
    const dystopian = getThemeConfig('dystopian-thames').water.turbidity;
    expect(bled).toBeLessThan(dystopian);
  });

  it('dystopian-thames has highest waveAmplitude (rough industrial river)', () => {
    const dystopian = getThemeConfig('dystopian-thames').water.waveAmplitude;
    for (const theme of ALL_THEMES.filter(t => t !== 'dystopian-thames')) {
      expect(dystopian).toBeGreaterThanOrEqual(getThemeConfig(theme).water.waveAmplitude);
    }
  });

  it('sun elevation varies meaningfully across themes (#126)', () => {
    const elevations = ALL_THEMES.map(t => getThemeConfig(t).lighting.sunElevation);
    const min = Math.min(...elevations);
    const max = Math.max(...elevations);
    expect(max - min).toBeGreaterThan(20);
  });

  it('colorGrading values are distinct across themes (#124)', () => {
    const satValues = ALL_THEMES.map(t => getThemeConfig(t).colorGrading.saturation);
    const unique = new Set(satValues);
    expect(unique.size).toBeGreaterThan(1);
  });

  it('scifi-boston has positive saturation boost (neon aesthetic)', () => {
    expect(getThemeConfig('scifi-boston').colorGrading.saturation).toBeGreaterThan(0);
  });

  it('dystopian-thames has negative saturation (desaturated dystopia)', () => {
    expect(getThemeConfig('dystopian-thames').colorGrading.saturation).toBeLessThan(0);
  });

  it('dystopian-thames has dense mist', () => {
    expect(getThemeConfig('dystopian-thames').mist.density).toBeGreaterThan(1);
  });

  it('gothic-venice has darker atmosphere than crystal-bled', () => {
    const venice = getThemeConfig('gothic-venice').atmosphere;
    const bled = getThemeConfig('crystal-bled').atmosphere;
    // fogFar should be shorter (denser fog) in gothic-venice
    expect(venice.fogFar).toBeLessThan(bled.fogFar);
  });
});

describe('trees config (#128)', () => {
  it('every theme has at least one tree species', () => {
    for (const theme of ALL_THEMES) {
      const trees = THEME_CONFIG[theme].trees;
      expect(Array.isArray(trees.species)).toBe(true);
      expect(trees.species.length).toBeGreaterThan(0);
    }
  });

  it('every species entry has required fields with valid ranges', () => {
    for (const theme of ALL_THEMES) {
      for (const s of THEME_CONFIG[theme].trees.species) {
        expect(typeof s.type).toBe('string');
        expect(typeof s.color).toBe('string');
        expect(typeof s.trunkColor).toBe('string');
        expect(Array.isArray(s.heightRange)).toBe(true);
        expect(s.heightRange).toHaveLength(2);
        expect(s.heightRange[0]).toBeLessThanOrEqual(s.heightRange[1]);
        expect(Array.isArray(s.radiusRange)).toBe(true);
        expect(s.radiusRange).toHaveLength(2);
        expect(s.radiusRange[0]).toBeLessThanOrEqual(s.radiusRange[1]);
        expect(typeof s.density).toBe('number');
        expect(s.density).toBeGreaterThan(0);
        expect(s.density).toBeLessThanOrEqual(1);
      }
    }
  });

  it('dystopian-thames has bare/dead trees only', () => {
    const types = THEME_CONFIG['dystopian-thames'].trees.species.map(s => s.type);
    expect(types.every(t => t === 'bare')).toBe(true);
  });

  it('crystal-bled has pine trees for alpine setting', () => {
    const types = THEME_CONFIG['crystal-bled'].trees.species.map(s => s.type);
    expect(types).toContain('pine');
  });

  it('willowbrook has willow trees', () => {
    const types = THEME_CONFIG['willowbrook'].trees.species.map(s => s.type);
    expect(types).toContain('willow');
  });
});

describe('architecture config (#129)', () => {
  const VALID_BUILDING_STYLES = ['georgian', 'gothic', 'canal', 'industrial', 'modern', 'futuristic'] as const;
  const VALID_ROOF_STYLES = ['flat', 'gabled', 'pointed', 'dome'] as const;
  const VALID_BRIDGE_STYLES = ['stone-arch', 'iron-truss', 'gondola-bridge', 'modern-cable'] as const;

  it('every theme has valid architecture config', () => {
    for (const theme of ALL_THEMES) {
      const a = THEME_CONFIG[theme].architecture;
      expect(VALID_BUILDING_STYLES).toContain(a.buildingStyle);
      expect(typeof a.wallMaterial.color).toBe('string');
      expect(typeof a.wallMaterial.roughness).toBe('number');
      expect(a.wallMaterial.roughness).toBeGreaterThanOrEqual(0);
      expect(a.wallMaterial.roughness).toBeLessThanOrEqual(1);
      expect(VALID_ROOF_STYLES).toContain(a.roofStyle);
      expect(typeof a.roofColor).toBe('string');
      expect(typeof a.hasBridges).toBe('boolean');
      expect(VALID_BRIDGE_STYLES).toContain(a.bridgeStyle);
    }
  });

  it('gothic-venice uses canal building style', () => {
    expect(THEME_CONFIG['gothic-venice'].architecture.buildingStyle).toBe('canal');
  });

  it('gothic-venice has gondola bridges', () => {
    expect(THEME_CONFIG['gothic-venice'].architecture.bridgeStyle).toBe('gondola-bridge');
  });

  it('willowbrook uses georgian style', () => {
    expect(THEME_CONFIG['willowbrook'].architecture.buildingStyle).toBe('georgian');
  });

  it('scifi-boston uses futuristic style with modern-cable bridges', () => {
    const a = THEME_CONFIG['scifi-boston'].architecture;
    expect(a.buildingStyle).toBe('futuristic');
    expect(a.bridgeStyle).toBe('modern-cable');
  });

  it('building styles are not all the same across themes', () => {
    const styles = ALL_THEMES.map(t => THEME_CONFIG[t].architecture.buildingStyle);
    const unique = new Set(styles);
    expect(unique.size).toBeGreaterThan(2);
  });
});

describe('groundCover config (#130)', () => {
  const VALID_TYPES = ['reed', 'rock', 'grass', 'flower', 'debris'] as const;

  it('every theme has at least one ground cover type', () => {
    for (const theme of ALL_THEMES) {
      const gc = THEME_CONFIG[theme].groundCover;
      expect(Array.isArray(gc.types)).toBe(true);
      expect(gc.types.length).toBeGreaterThan(0);
    }
  });

  it('every ground cover entry has required fields', () => {
    for (const theme of ALL_THEMES) {
      for (const t of THEME_CONFIG[theme].groundCover.types) {
        expect(VALID_TYPES).toContain(t.type);
        expect(typeof t.color).toBe('string');
        expect(typeof t.density).toBe('number');
        expect(t.density).toBeGreaterThan(0);
        expect(t.density).toBeLessThanOrEqual(1);
        expect(typeof t.scale).toBe('number');
        expect(t.scale).toBeGreaterThan(0);
      }
    }
  });

  it('dystopian-thames has debris ground cover', () => {
    const types = THEME_CONFIG['dystopian-thames'].groundCover.types.map(t => t.type);
    expect(types).toContain('debris');
  });

  it('willowbrook has reeds and flowers', () => {
    const types = THEME_CONFIG['willowbrook'].groundCover.types.map(t => t.type);
    expect(types).toContain('reed');
    expect(types).toContain('flower');
  });
});

describe('horizon config (#131)', () => {
  const VALID_TYPES = ['mountains', 'city', 'hills', 'industrial', 'islands'] as const;

  it('every theme has valid horizon config', () => {
    for (const theme of ALL_THEMES) {
      const h = THEME_CONFIG[theme].horizon;
      expect(VALID_TYPES).toContain(h.type);
      expect(typeof h.color).toBe('string');
      expect(typeof h.distance).toBe('number');
      expect(h.distance).toBeGreaterThan(0);
      expect(typeof h.height).toBe('number');
      expect(h.height).toBeGreaterThan(0);
    }
  });

  it('crystal-bled has mountain horizon', () => {
    expect(THEME_CONFIG['crystal-bled'].horizon.type).toBe('mountains');
  });

  it('scifi-boston has city horizon', () => {
    expect(THEME_CONFIG['scifi-boston'].horizon.type).toBe('city');
  });

  it('dystopian-thames has industrial horizon', () => {
    expect(THEME_CONFIG['dystopian-thames'].horizon.type).toBe('industrial');
  });

  it('mountain horizons are taller than island horizons', () => {
    const mountainThemes = ALL_THEMES.filter(t => THEME_CONFIG[t].horizon.type === 'mountains');
    const islandThemes = ALL_THEMES.filter(t => THEME_CONFIG[t].horizon.type === 'islands');
    if (mountainThemes.length > 0 && islandThemes.length > 0) {
      const avgMountain = mountainThemes.reduce((s, t) => s + THEME_CONFIG[t].horizon.height, 0) / mountainThemes.length;
      const avgIsland = islandThemes.reduce((s, t) => s + THEME_CONFIG[t].horizon.height, 0) / islandThemes.length;
      expect(avgMountain).toBeGreaterThan(avgIsland);
    }
  });

  it('horizon types are diverse across themes', () => {
    const types = ALL_THEMES.map(t => THEME_CONFIG[t].horizon.type);
    const unique = new Set(types);
    expect(unique.size).toBeGreaterThan(2);
  });
});
