import { describe, expect, it } from 'vitest';
import {
  SCENERY_PROFILES,
  type SceneryProfileConfig,
} from '../components/rower3d/sceneryConfig';
import {
  getSegmentSceneryProfile,
  BASE_BUILDING_HEIGHT,
} from '../components/rower3d/bankComponents';
import type { SceneryProfile } from '../services/routeEnrichmentService';
import type { RouteEnrichmentData } from '../services/routeEnrichmentService';

const ALL_PROFILES: SceneryProfile[] = [
  'forest',
  'residential',
  'commercial',
  'farmland',
  'beach',
  'wetland',
  'fallback',
];

describe('SCENERY_PROFILES', () => {
  it('has an entry for every SceneryProfile', () => {
    for (const profile of ALL_PROFILES) {
      expect(SCENERY_PROFILES[profile]).toBeDefined();
    }
  });

  it('every entry has all required sections', () => {
    for (const profile of ALL_PROFILES) {
      const cfg: SceneryProfileConfig = SCENERY_PROFILES[profile];
      expect(cfg).toHaveProperty('trees');
      expect(cfg).toHaveProperty('groundCover');
      expect(cfg).toHaveProperty('buildings');
    }
  });

  it('trees config has valid density, species array, and scaleRange', () => {
    for (const profile of ALL_PROFILES) {
      const { trees } = SCENERY_PROFILES[profile];
      expect(typeof trees.density).toBe('number');
      expect(trees.density).toBeGreaterThan(0);
      expect(trees.density).toBeLessThanOrEqual(1);
      expect(Array.isArray(trees.species)).toBe(true);
      expect(trees.species.length).toBeGreaterThan(0);
      expect(Array.isArray(trees.scaleRange)).toBe(true);
      expect(trees.scaleRange).toHaveLength(2);
      const [scaleMin, scaleMax] = trees.scaleRange;
      expect(scaleMin).toBeGreaterThan(0);
      expect(scaleMax).toBeGreaterThanOrEqual(scaleMin);
    }
  });

  it('groundCover config has valid density and types array', () => {
    for (const profile of ALL_PROFILES) {
      const { groundCover } = SCENERY_PROFILES[profile];
      expect(typeof groundCover.density).toBe('number');
      expect(groundCover.density).toBeGreaterThan(0);
      expect(groundCover.density).toBeLessThanOrEqual(1);
      expect(Array.isArray(groundCover.types)).toBe(true);
      expect(groundCover.types.length).toBeGreaterThan(0);
    }
  });

  it('buildings config has valid probability and heightRange', () => {
    for (const profile of ALL_PROFILES) {
      const { buildings } = SCENERY_PROFILES[profile];
      expect(typeof buildings.probability).toBe('number');
      expect(buildings.probability).toBeGreaterThanOrEqual(0);
      expect(buildings.probability).toBeLessThanOrEqual(1);
      expect(Array.isArray(buildings.heightRange)).toBe(true);
      expect(buildings.heightRange).toHaveLength(2);
      const [hMin, hMax] = buildings.heightRange;
      expect(hMin).toBeGreaterThan(0);
      expect(hMax).toBeGreaterThanOrEqual(hMin);
    }
  });

  it('groundCover types are drawn from valid type names', () => {
    const VALID_TYPES = new Set(['reed', 'rock', 'grass', 'flower', 'debris']);
    for (const profile of ALL_PROFILES) {
      for (const type of SCENERY_PROFILES[profile].groundCover.types) {
        expect(VALID_TYPES.has(type)).toBe(true);
      }
    }
  });

  it('species types are drawn from valid tree species names', () => {
    const VALID_SPECIES = new Set([
      'pine', 'willow', 'oak', 'cypress', 'palm', 'bare', 'ornamental',
    ]);
    for (const profile of ALL_PROFILES) {
      for (const species of SCENERY_PROFILES[profile].trees.species) {
        expect(VALID_SPECIES.has(species)).toBe(true);
      }
    }
  });

  it('forest profile has the highest tree density', () => {
    const forestDensity = SCENERY_PROFILES.forest.trees.density;
    for (const profile of ALL_PROFILES) {
      if (profile !== 'forest') {
        expect(forestDensity).toBeGreaterThanOrEqual(
          SCENERY_PROFILES[profile].trees.density,
        );
      }
    }
  });

  it('commercial profile has the highest building probability', () => {
    const commercialProb = SCENERY_PROFILES.commercial.buildings.probability;
    for (const profile of ALL_PROFILES) {
      if (profile !== 'commercial') {
        expect(commercialProb).toBeGreaterThanOrEqual(
          SCENERY_PROFILES[profile].buildings.probability,
        );
      }
    }
  });

  it('commercial profile has the tallest building heightRange max', () => {
    const commercialMax = SCENERY_PROFILES.commercial.buildings.heightRange[1];
    for (const profile of ALL_PROFILES) {
      if (profile !== 'commercial') {
        expect(commercialMax).toBeGreaterThanOrEqual(
          SCENERY_PROFILES[profile].buildings.heightRange[1],
        );
      }
    }
  });

  it('wetland and forest profiles have the highest groundCover density', () => {
    const wetlandDensity = SCENERY_PROFILES.wetland.groundCover.density;
    const forestDensity  = SCENERY_PROFILES.forest.groundCover.density;
    const highDensity    = Math.max(wetlandDensity, forestDensity);
    for (const profile of ALL_PROFILES) {
      if (profile !== 'wetland' && profile !== 'forest') {
        expect(highDensity).toBeGreaterThanOrEqual(
          SCENERY_PROFILES[profile].groundCover.density,
        );
      }
    }
  });

  it('profile species lists are distinct enough to drive visual variety', () => {
    // Forest should prefer different species than commercial
    const forestSpecies     = new Set(SCENERY_PROFILES.forest.trees.species);
    const commercialSpecies = new Set(SCENERY_PROFILES.commercial.trees.species);
    // They should not be identical
    const identical =
      forestSpecies.size === commercialSpecies.size &&
      [...forestSpecies].every(s => commercialSpecies.has(s));
    expect(identical).toBe(false);
  });
});

// ============================================================================
// Helpers from bankComponents
// ============================================================================

const makeEnrichment = (profiles: Array<{ sceneryProfile: SceneryProfile }>): RouteEnrichmentData => ({
  routeId: 'test',
  elevations: [],
  segmentProfiles: profiles.map((p, i) => ({
    index: i,
    startMeters: i * 50,
    endMeters: (i + 1) * 50,
    sceneryProfile: p.sceneryProfile,
    treeDensity: 0.5,
    vegetationDensity: 0.5,
    buildingDensity: 0.1,
    objectScale: 1,
    waterWidthMeters: 30,
    dragMultiplier: 1,
    bearing: 0,
    bearingDelta: 0,
  })),
  waterBodyType: 'river',
  waterWidthMeters: 30,
  waterColor: '#000',
  waveIntensity: 1,
  fetchedAt: 0,
  source: 'fallback',
});

describe('getSegmentSceneryProfile', () => {
  it('returns fallback for null enrichment', () => {
    expect(getSegmentSceneryProfile(null, 0.5)).toBe('fallback');
  });

  it('returns fallback for undefined enrichment', () => {
    expect(getSegmentSceneryProfile(undefined, 0.5)).toBe('fallback');
  });

  it('returns fallback when segmentProfiles is empty', () => {
    const enrichment = makeEnrichment([]);
    expect(getSegmentSceneryProfile(enrichment, 0.5)).toBe('fallback');
  });

  it('returns the only segment profile for a single-segment route', () => {
    const enrichment = makeEnrichment([{ sceneryProfile: 'forest' }]);
    expect(getSegmentSceneryProfile(enrichment, 0)).toBe('forest');
    expect(getSegmentSceneryProfile(enrichment, 0.5)).toBe('forest');
    expect(getSegmentSceneryProfile(enrichment, 1)).toBe('forest');
  });

  it('selects the first segment at progress 0', () => {
    const enrichment = makeEnrichment([
      { sceneryProfile: 'forest' },
      { sceneryProfile: 'commercial' },
      { sceneryProfile: 'wetland' },
    ]);
    expect(getSegmentSceneryProfile(enrichment, 0)).toBe('forest');
  });

  it('selects the last segment at progress 1', () => {
    const enrichment = makeEnrichment([
      { sceneryProfile: 'forest' },
      { sceneryProfile: 'commercial' },
      { sceneryProfile: 'wetland' },
    ]);
    expect(getSegmentSceneryProfile(enrichment, 1)).toBe('wetland');
  });

  it('selects the nearest segment at progress 0.5', () => {
    const enrichment = makeEnrichment([
      { sceneryProfile: 'forest' },
      { sceneryProfile: 'commercial' },
    ]);
    expect(getSegmentSceneryProfile(enrichment, 0.5)).toBe('commercial');
  });

  it('clamps out-of-range progress values', () => {
    const enrichment = makeEnrichment([
      { sceneryProfile: 'beach' },
      { sceneryProfile: 'farmland' },
    ]);
    expect(getSegmentSceneryProfile(enrichment, -0.5)).toBe('beach');
    expect(getSegmentSceneryProfile(enrichment, 2)).toBe('farmland');
  });

  it('handles non-finite progress values safely', () => {
    const enrichment = makeEnrichment([
      { sceneryProfile: 'forest' },
      { sceneryProfile: 'wetland' },
    ]);
    expect(getSegmentSceneryProfile(enrichment, Number.NaN)).toBe('forest');
    expect(getSegmentSceneryProfile(enrichment, Number.POSITIVE_INFINITY)).toBe('wetland');
    expect(getSegmentSceneryProfile(enrichment, Number.NEGATIVE_INFINITY)).toBe('forest');
  });
});

describe('BASE_BUILDING_HEIGHT', () => {
  it('is a positive number', () => {
    expect(typeof BASE_BUILDING_HEIGHT).toBe('number');
    expect(BASE_BUILDING_HEIGHT).toBeGreaterThan(0);
  });

  it('produces building heights within each profile heightRange', () => {
    for (const profile of ALL_PROFILES) {
      const [hMin, hMax] = SCENERY_PROFILES[profile].buildings.heightRange;
      const minHeight = BASE_BUILDING_HEIGHT * hMin;
      const maxHeight = BASE_BUILDING_HEIGHT * hMax;
      expect(minHeight).toBeGreaterThan(0);
      expect(maxHeight).toBeGreaterThanOrEqual(minHeight);
    }
  });
});
