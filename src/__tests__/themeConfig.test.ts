import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SCENE_CONFIG } from '../components/rower3d/themeConfig';
import {
  BLOOM_SAFE_LUMINANCE,
  bloomSafeFoamColor,
  foamLuminance,
} from '../components/rower3d/wakeTexture';

describe('SCENE_CONFIG', () => {
  it('has every section the scene reads', () => {
    expect(Object.keys(SCENE_CONFIG).sort()).toEqual([
      'architecture',
      'atmosphere',
      'bank',
      'clouds',
      'colorGrading',
      'groundCover',
      'horizon',
      'landscapeColors',
      'lighting',
      'sky',
      'trees',
      'water',
    ]);
  });

  it('water has all required fields', () => {
    const w = SCENE_CONFIG.water;
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
    expect(w.waveAmplitude).toBeGreaterThan(0);
    expect(w.waveFrequency).toBeGreaterThan(0);
    expect(w.foamIntensity).toBeGreaterThanOrEqual(0);
    expect(w.foamIntensity).toBeLessThanOrEqual(1);
    // #323 — the foam colour reaches a material only after `bloomSafeFoamColor`
    // caps it, so what it is capped *to* is what has to stay under the bloom
    // pass's threshold.
    expect(w.foamColor).toMatch(/^#[0-9a-f]{6}$/i);
    expect(foamLuminance(bloomSafeFoamColor(w.foamColor))).toBeLessThanOrEqual(
      BLOOM_SAFE_LUMINANCE,
    );
  });

  it('bank has all required fields', () => {
    const b = SCENE_CONFIG.bank;
    expect(typeof b.color).toBe('string');
    expect(typeof b.roughness).toBe('number');
    expect(typeof b.metalness).toBe('number');
    expect(typeof b.emissive).toBe('string');
    expect(typeof b.emissiveIntensity).toBe('number');
    expect(typeof b.sheen).toBe('number');
    expect(typeof b.sheenColor).toBe('string');
    expect(typeof b.flatColor).toBe('string');
  });

  it('landscapeColors has all required fields', () => {
    const lc = SCENE_CONFIG.landscapeColors;
    expect(typeof lc.mountain).toBe('string');
    expect(typeof lc.mountainSnow).toBe('string');
    expect(typeof lc.buildingAccent).toBe('string');
    expect(typeof lc.windowGlow).toBe('string');
  });

  it('atmosphere has all required fields', () => {
    const a = SCENE_CONFIG.atmosphere;
    expect(typeof a.fogColor).toBe('string');
    expect(typeof a.fogNear).toBe('number');
    expect(typeof a.fogFar).toBe('number');
  });

  it('sky has all required fields with valid ranges', () => {
    const sky = SCENE_CONFIG.sky;
    // No `sunPosition` here (#352): a second place to author the sun is a
    // second answer, and the two disagreed for as long as both existed.
    expect(sky).not.toHaveProperty('sunPosition');
    expect(sky.turbidity).toBeGreaterThanOrEqual(0);
    expect(typeof sky.rayleigh).toBe('number');
    expect(typeof sky.mieCoefficient).toBe('number');
    expect(sky.mieDirectionalG).toBeGreaterThanOrEqual(0);
    expect(sky.mieDirectionalG).toBeLessThanOrEqual(1);
    expect(typeof sky.exposure).toBe('number');
  });

  it('clouds have all required fields', () => {
    const clouds = SCENE_CONFIG.clouds;
    expect(typeof clouds.enabled).toBe('boolean');
    expect(clouds.count).toBeGreaterThan(0);
    expect(clouds.opacity).toBeGreaterThanOrEqual(0);
    expect(clouds.opacity).toBeLessThanOrEqual(1);
    expect(typeof clouds.speed).toBe('number');
    expect(typeof clouds.color).toBe('string');
    expect(typeof clouds.segments).toBe('number');
    expect(typeof clouds.scale).toBe('number');
    expect(typeof clouds.depth).toBe('number');
  });

  it('lighting has all required fields with valid ranges (#108)', () => {
    const l = SCENE_CONFIG.lighting;
    expect(typeof l.ambientColor).toBe('string');
    expect(l.ambientIntensity).toBeGreaterThanOrEqual(0);
    expect(typeof l.sunColor).toBe('string');
    expect(l.sunIntensity).toBeGreaterThanOrEqual(0);
    expect(typeof l.fillColor).toBe('string');
    expect(l.fillIntensity).toBeGreaterThanOrEqual(0);
    // Phase 6 lighting profile (#126)
    expect(l.sunElevation).toBeGreaterThanOrEqual(0);
    expect(l.sunElevation).toBeLessThanOrEqual(90);
    expect(l.sunAzimuth).toBeGreaterThanOrEqual(0);
    expect(l.sunAzimuth).toBeLessThan(360);
  });

  it('colorGrading has all required fields with valid ranges (#124)', () => {
    const cg = SCENE_CONFIG.colorGrading;
    expect(cg.hue).toBeGreaterThanOrEqual(-0.5);
    expect(cg.hue).toBeLessThanOrEqual(0.5);
    expect(cg.saturation).toBeGreaterThanOrEqual(-1);
    expect(cg.saturation).toBeLessThanOrEqual(1);
    expect(cg.brightness).toBeGreaterThanOrEqual(-1);
    expect(cg.brightness).toBeLessThanOrEqual(1);
    expect(cg.contrast).toBeGreaterThanOrEqual(-1);
    expect(cg.contrast).toBeLessThanOrEqual(1);
  });
});

describe('trees config (#128)', () => {
  it('has at least one tree species', () => {
    expect(SCENE_CONFIG.trees.species.length).toBeGreaterThan(0);
  });

  it('gives every species its colours', () => {
    for (const s of SCENE_CONFIG.trees.species) {
      expect(typeof s.type).toBe('string');
      expect(typeof s.color).toBe('string');
      expect(typeof s.trunkColor).toBe('string');
    }
  });

  it('has willow trees', () => {
    expect(SCENE_CONFIG.trees.species.map((s) => s.type)).toContain('willow');
  });
});

describe('architecture config (#129)', () => {
  it('describes the village houses the bank builds', () => {
    const a = SCENE_CONFIG.architecture;
    expect(typeof a.wallMaterial.color).toBe('string');
    expect(a.wallMaterial.roughness).toBeGreaterThanOrEqual(0);
    expect(a.wallMaterial.roughness).toBeLessThanOrEqual(1);
    expect(typeof a.roofColor).toBe('string');
  });
});

describe('groundCover config (#130)', () => {
  const VALID_TYPES = ['reed', 'rock', 'grass', 'flower', 'debris'] as const;

  it('has at least one ground cover type', () => {
    expect(SCENE_CONFIG.groundCover.types.length).toBeGreaterThan(0);
  });

  it('gives every ground cover entry its fields', () => {
    for (const t of SCENE_CONFIG.groundCover.types) {
      expect(VALID_TYPES).toContain(t.type);
      expect(typeof t.color).toBe('string');
      expect(t.scale).toBeGreaterThan(0);
    }
  });

  it('has reeds and flowers', () => {
    const types = SCENE_CONFIG.groundCover.types.map((t) => t.type);
    expect(types).toContain('reed');
    expect(types).toContain('flower');
  });
});

describe('horizon config (#131)', () => {
  it('has a valid horizon', () => {
    const h = SCENE_CONFIG.horizon;
    expect(typeof h.color).toBe('string');
    expect(h.distance).toBeGreaterThan(0);
    expect(h.height).toBeGreaterThan(0);
  });
});

/**
 * Issue #364 — the machinery that chose between six themes, and the fields
 * only those themes read, are gone from the whole source tree. Read from the
 * files rather than the object, because a type or an interface field leaves
 * nothing at runtime.
 *
 * Each name is assembled from parts so this file does not contain it: the
 * issue's own check is a grep of `src/`, tests included.
 */
describe('what the retired themes left behind (#364)', () => {
  const sourceFiles = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return sourceFiles(path);
      return /\.(ts|tsx|js|mjs)$/.test(entry.name) ? [path] : [];
    });
  const files = sourceFiles('src').map((path) => ({ path, text: readFileSync(path, 'utf8') }));

  it.each([
    ['Route', 'Theme'],
    ['detect', 'Route', 'Theme'],
    ['get', 'ThemeConfig'],
    ['THEME', '_CONFIG'],
    ['themeUses', 'GlbScenery'],
    ['Landscape', 'Source'],
    ['landscape', 'Source'],
    ['building', 'Style'],
    ['bridge', 'Style'],
    ['has', 'Bridges'],
    ['roof', 'Style'],
  ].map((parts) => parts.join('')))('names %s nowhere in src/', (name) => {
    const pattern = new RegExp(`\\b${name}\\b`);
    expect(files.filter(({ text }) => pattern.test(text)).map(({ path }) => path)).toEqual([]);
  });
});
