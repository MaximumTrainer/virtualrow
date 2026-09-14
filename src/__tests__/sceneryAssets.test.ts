import { describe, it, expect } from 'vitest';
import {
  sceneryAssetPath,
  resolveSceneryModels,
  collectSceneryPaths,
  SCENERY_PROFILE_MODELS,
  WATER_BODY_MODELS,
  TREE_SPECIES_MODELS,
} from '../components/rower3d/sceneryAssets';
import type {
  SceneryProfile,
  WaterBodyType,
} from '../services/routeEnrichmentService';

const PROFILES: SceneryProfile[] = [
  'forest', 'residential', 'commercial', 'farmland', 'beach', 'wetland', 'fallback',
];
const WATER_TYPES: WaterBodyType[] = [
  'river', 'canal', 'stream', 'lake', 'reservoir', 'unknown',
];

describe('sceneryAssetPath', () => {
  it('derives the tier folder from the id prefix', () => {
    expect(sceneryAssetPath('f01-bank-earth-cut')).toBe('/assets/scenery/tier-f/f01-bank-earth-cut.glb');
    expect(sceneryAssetPath('e04-english-oak')).toBe('/assets/scenery/tier-e/e04-english-oak.glb');
    expect(sceneryAssetPath('a01-buoy-lane-sphere')).toBe('/assets/scenery/tier-a/a01-buoy-lane-sphere.glb');
    expect(sceneryAssetPath('d-nl-02-polder-windmill')).toBe('/assets/scenery/tier-d/d-nl-02-polder-windmill.glb');
  });
});

describe('selection matrices', () => {
  it('define a model set for every scenery profile', () => {
    for (const p of PROFILES) {
      expect(SCENERY_PROFILE_MODELS[p]).toBeDefined();
      expect(SCENERY_PROFILE_MODELS[p].bankEdge.length).toBeGreaterThan(0);
    }
  });

  it('define a model set for every water-body type', () => {
    for (const w of WATER_TYPES) {
      expect(WATER_BODY_MODELS[w]).toBeDefined();
      expect(WATER_BODY_MODELS[w].surface.length).toBeGreaterThan(0);
    }
  });

  it('only reference Tier F ids in the biome matrices', () => {
    const all = [
      ...PROFILES.flatMap((p) => [
        ...SCENERY_PROFILE_MODELS[p].bankEdge,
        ...SCENERY_PROFILE_MODELS[p].landform,
        ...SCENERY_PROFILE_MODELS[p].scatter,
        ...SCENERY_PROFILE_MODELS[p].backdrop,
      ]),
      ...WATER_TYPES.flatMap((w) => [
        ...WATER_BODY_MODELS[w].bankEdge,
        ...WATER_BODY_MODELS[w].inWater,
        ...WATER_BODY_MODELS[w].surface,
      ]),
    ];
    for (const id of all) expect(id.startsWith('f')).toBe(true);
  });

  it('maps tree species to Tier E ids only', () => {
    for (const ids of Object.values(TREE_SPECIES_MODELS)) {
      for (const id of ids) expect(id.startsWith('e')).toBe(true);
    }
  });
});

describe('resolveSceneryModels', () => {
  it('merges and de-duplicates profile + water bank edges', () => {
    // river bankEdge and fallback bankEdge both contain f01; it must appear once.
    const r = resolveSceneryModels('fallback', 'river');
    const f01 = r.bankEdge.filter((id) => id === 'f01-bank-earth-cut');
    expect(f01).toHaveLength(1);
    // pulls from both sources
    expect(r.bankEdge).toContain('f01-bank-earth-cut'); // fallback + river
    expect(r.bankEdge).toContain('f17-mudflat-tidal');  // river only
  });

  it('resolves trees from the supplied species list', () => {
    const r = resolveSceneryModels('forest', 'lake', ['pine', 'oak']);
    expect(r.trees).toContain('e07-eastern-white-pine');
    expect(r.trees).toContain('e04-english-oak');
    // unrequested species are absent
    expect(r.trees).not.toContain('e10-italian-cypress');
  });

  it('always includes the universal rowing furniture', () => {
    const r = resolveSceneryModels('commercial', 'reservoir');
    expect(r.furniture).toContain('a01-buoy-lane-sphere');
  });

  it('falls back gracefully for every enum combination', () => {
    for (const p of PROFILES) {
      for (const w of WATER_TYPES) {
        const r = resolveSceneryModels(p, w, ['pine', 'willow']);
        expect(r.bankEdge.length).toBeGreaterThan(0);
        expect(collectSceneryPaths(r).every((path) => path.endsWith('.glb'))).toBe(true);
      }
    }
  });
});

describe('collectSceneryPaths', () => {
  it('returns unique .glb paths', () => {
    const paths = collectSceneryPaths(resolveSceneryModels('farmland', 'canal', ['oak']));
    expect(new Set(paths).size).toBe(paths.length);
    expect(paths.every((p) => p.startsWith('/assets/scenery/'))).toBe(true);
  });
});
