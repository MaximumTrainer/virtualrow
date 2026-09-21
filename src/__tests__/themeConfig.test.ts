import { describe, it, expect } from 'vitest';
import {
  THEME_CONFIG,
  getThemeConfig,
  type RouteTheme,
} from '../components/rower3d/themeConfig';

const ALL_THEMES: RouteTheme[] = [
  'willowbrook',
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
      expect(cfg).toHaveProperty('bank');
      expect(cfg).toHaveProperty('landscapeColors');
      expect(cfg).toHaveProperty('atmosphere');
      expect(cfg).toHaveProperty('sky');
      expect(cfg).toHaveProperty('clouds');
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

});

describe('getThemeConfig', () => {
  it('returns the correct config for each known theme', () => {
    for (const theme of ALL_THEMES) {
      expect(getThemeConfig(theme)).toBe(THEME_CONFIG[theme]);
    }
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

  it('willowbrook uses georgian style', () => {
    expect(THEME_CONFIG['willowbrook'].architecture.buildingStyle).toBe('georgian');
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

});
