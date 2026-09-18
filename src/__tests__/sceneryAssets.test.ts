import fs from 'fs';
import path from 'path';
import { describe, it, expect } from 'vitest';
import { afterEach } from 'vitest';
import {
  sceneryAssetPath,
  resolveSceneryModels,
  collectSceneryPaths,
  isGlbSceneryEnabled,
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

describe('isGlbSceneryEnabled', () => {
  const w = window as unknown as { __VIRTUALROW_SCENERY_MODELS?: boolean };
  afterEach(() => {
    delete w.__VIRTUALROW_SCENERY_MODELS;
    window.history.replaceState({}, '', '/');
  });

  it('is on for a rower once the cost is validated (#232 phase 3)', () => {
    expect(isGlbSceneryEnabled()).toBe(true);
  });

  it('is on with the window flag', () => {
    w.__VIRTUALROW_SCENERY_MODELS = true;
    expect(isGlbSceneryEnabled()).toBe(true);
  });

  it('ignores a glb query parameter', () => {
    // The parameter is gone: the kit is switched from the debug panel now, so
    // a stray ?glb= in a shared URL must not quietly change what renders (#270).
    window.history.replaceState({}, '', '/?glb=0');
    expect(isGlbSceneryEnabled()).toBe(true);

    window.history.replaceState({}, '', '/?glb=1');
    expect(isGlbSceneryEnabled()).toBe(true);
  });

  it('lets the window flag turn it off too', () => {
    w.__VIRTUALROW_SCENERY_MODELS = false;
    expect(isGlbSceneryEnabled()).toBe(false);
  });

  it('is off under automation that never loaded the BLE mock', () => {
    // __PLAYWRIGHT_TESTING is set by mock-bluetooth.js alone, so specs that
    // drive the real signed-out UI — signed-out-test-drive among them — were
    // treated as a rower and paid for the whole kit while asserting no
    // pageerror. Automation is a property of the browser, not of which
    // fixture a spec happened to load (review of #232).
    const nav = window.navigator as unknown as { webdriver?: boolean };
    const had = Object.prototype.hasOwnProperty.call(nav, 'webdriver');
    Object.defineProperty(nav, 'webdriver', { value: true, configurable: true });
    try {
      expect(isGlbSceneryEnabled()).toBe(false);

      // ...and such a spec can still opt in explicitly.
      w.__VIRTUALROW_SCENERY_MODELS = true;
      expect(isGlbSceneryEnabled()).toBe(true);
    } finally {
      if (had) Object.defineProperty(nav, 'webdriver', { value: false, configurable: true });
      else delete (nav as { webdriver?: boolean }).webdriver;
    }
  });

  it('is off under automation unless a spec asks for it, so suites stay fast', () => {
    const win = window as unknown as { __PLAYWRIGHT_TESTING?: boolean };
    win.__PLAYWRIGHT_TESTING = true;
    try {
      expect(isGlbSceneryEnabled()).toBe(false);
      w.__VIRTUALROW_SCENERY_MODELS = true;
      expect(isGlbSceneryEnabled()).toBe(true);
    } finally {
      delete win.__PLAYWRIGHT_TESTING;
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

describe('scenery models are fetched for the route, not on import', () => {
  it('does not preload a fixed model set when the module loads', () => {
    // A module-scope useGLTF.preload of the fallback/unknown set was harmless
    // while the kit was opt-in and the branch was dead. Turning the kit on by
    // default made it fetch ~18 GLBs on every session, most of which the
    // Willowbrook track's own profiles never use. The component's
    // useGLTF(paths) already loads exactly the set the route needs, so there
    // is nothing left for a preload to warm (review of #232).
    const source = fs.readFileSync(
      path.join(process.cwd(), 'src/components/rower3d/sceneryModels.tsx'),
      'utf-8',
    );

    expect(source).not.toContain('useGLTF.preload');
  });
});
