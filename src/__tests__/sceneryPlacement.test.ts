import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  budgetFor,
  distinctProfiles,
  pick,
  computePlacements,
  CATEGORY_OFFSET,
  ASSET_SCALE,
  type Placement,
} from '../components/rower3d/sceneryPlacement';
import { resolveSceneryModels, type ResolvedScenery } from '../components/rower3d/sceneryAssets';
import {
  WILLOWBROOK_SCENERY_TRACK,
  trackProfiles,
  trackWaterForProfile,
} from '../components/rower3d/sceneryTrack';
import type { RouteEnrichmentData, SceneryProfile } from '../services/routeEnrichmentService';

const fallbackResolved = resolveSceneryModels('fallback', 'unknown', ['pine', 'oak', 'willow']);
const byProfile = (r: ResolvedScenery = fallbackResolved) => {
  const m = new Map<SceneryProfile, ResolvedScenery>();
  m.set('fallback', r);
  return m;
};

const enrichment = (profiles: SceneryProfile[]): RouteEnrichmentData =>
  ({
    routeId: 'test',
    elevations: [0, 1, 2, 3, 2, 1, 0],
    segmentProfiles: profiles.map((sceneryProfile, i) => ({
      index: i, startMeters: i * 50, endMeters: (i + 1) * 50,
      sceneryProfile, treeDensity: 0.5, vegetationDensity: 0.5, buildingDensity: 0.2,
      objectScale: 1, waterWidthMeters: 20, dragMultiplier: 1, bearing: 0, bearingDelta: 0,
    })),
    waterBodyType: 'river', waterWidthMeters: 20, waterColor: '#000',
    waveIntensity: 0.5, fetchedAt: 0, source: 'fallback',
  }) as RouteEnrichmentData;

const validPlacement = (p: Placement) => {
  expect(p.position).toHaveLength(3);
  expect(p.position.every(Number.isFinite)).toBe(true);
  expect(Number.isFinite(p.rotationY)).toBe(true);
  expect(p.scale).toBeGreaterThan(0);
  expect(p.progress).toBeGreaterThanOrEqual(0);
  expect(p.progress).toBeLessThanOrEqual(1);
  expect(typeof p.id).toBe('string');
};

describe('budgetFor', () => {
  it('scales instance count by performance mode', () => {
    expect(budgetFor('high')).toBe(1);
    expect(budgetFor('low')).toBe(0.4);
    expect(budgetFor('auto')).toBe(0.7);
  });
});

describe('distinctProfiles', () => {
  it('returns [fallback] when there is no enrichment', () => {
    expect(distinctProfiles(null)).toEqual(['fallback']);
    expect(distinctProfiles(undefined)).toEqual(['fallback']);
  });
  it('de-duplicates the segment profiles', () => {
    const p = distinctProfiles(enrichment(['forest', 'forest', 'residential']));
    expect(p).toContain('forest');
    expect(p).toContain('residential');
    expect(p).toHaveLength(2);
  });
});

describe('pick', () => {
  it('returns null for an empty list', () => {
    expect(pick([], 1)).toBeNull();
  });
  it('is deterministic and in range', () => {
    const ids = ['a', 'b', 'c'];
    expect(pick(ids, 42)).toBe(pick(ids, 42));
    expect(ids).toContain(pick(ids, 7));
  });
});

describe('computePlacements — flat mode', () => {
  it('lays bands per bank with valid placements from the resolved set', () => {
    const allIds = new Set(Object.values(fallbackResolved).flat());
    const out = computePlacements({ enrichment: null, resolvedByProfile: byProfile(), budget: 1, side: 'left' });
    expect(out.length).toBeGreaterThan(0);
    for (const p of out) {
      validPlacement(p);
      expect(allIds.has(p.id)).toBe(true);
    }
  });

  it('places fewer instances at a lower budget', () => {
    const hi = computePlacements({ resolvedByProfile: byProfile(), budget: 1, side: 'left' });
    const lo = computePlacements({ resolvedByProfile: byProfile(), budget: 0.4, side: 'left' });
    expect(lo.length).toBeLessThan(hi.length);
  });

  it('mirrors left/right banks to opposite sides of the centreline', () => {
    const left = computePlacements({ resolvedByProfile: byProfile(), budget: 1, side: 'left' });
    const right = computePlacements({ resolvedByProfile: byProfile(), budget: 1, side: 'right' });
    // flat mode offsets along +x (perp), signed by side; water at x=0.
    expect(left.some((p) => p.position[0] < 0)).toBe(true);
    expect(right.some((p) => p.position[0] > 0)).toBe(true);
  });

  it('returns nothing when no profile resolves', () => {
    const empty = new Map<SceneryProfile, ResolvedScenery>();
    expect(computePlacements({ resolvedByProfile: empty, budget: 1, side: 'left' })).toEqual([]);
  });
});

describe('computePlacements — curve mode', () => {
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0, -200),
    new THREE.Vector3(20, 0, -100),
    new THREE.Vector3(-20, 0, 0),
    new THREE.Vector3(20, 0, 100),
    new THREE.Vector3(0, 0, 200),
  ]);

  it('samples the curve and offsets instances off the rowed line', () => {
    const out = computePlacements({
      curve,
      enrichment: enrichment(['fallback', 'forest', 'residential']),
      resolvedByProfile: byProfile(),
      budget: 1,
      side: 'left',
    });
    expect(out.length).toBeGreaterThan(0);
    out.forEach(validPlacement);
    // instances span the length of the route
    expect(Math.min(...out.map((p) => p.progress))).toBeLessThan(0.2);
    expect(Math.max(...out.map((p) => p.progress))).toBeGreaterThan(0.8);
  });

  it('respects surface height (y ≈ 0.15) for water dressing', () => {
    const out = computePlacements({ curve, enrichment: enrichment(['fallback']), resolvedByProfile: byProfile(), budget: 1, side: 'left' });
    const surfaceIds = new Set(fallbackResolved.surface);
    const surfaces = out.filter((p) => surfaceIds.has(p.id));
    // surface models exist for the fallback set and sit just above the water
    if (surfaces.length > 0) {
      expect(surfaces.every((p) => Math.abs(p.position[1] - 0.15) < 1e-6)).toBe(true);
    }
  });
});

describe('placement constants', () => {
  it('defines an offset band and a positive scale for every category', () => {
    for (const band of Object.values(CATEGORY_OFFSET)) {
      expect(band[0]).toBeLessThanOrEqual(band[1]);
    }
    expect(ASSET_SCALE).toBeGreaterThan(0);
  });
});

describe('an authored track dresses the route (#232)', () => {
  const resolvedForTrack = () => {
    const map = new Map<SceneryProfile, ResolvedScenery>();
    for (const profile of trackProfiles(WILLOWBROOK_SCENERY_TRACK)) {
      map.set(
        profile,
        resolveSceneryModels(profile, trackWaterForProfile(WILLOWBROOK_SCENERY_TRACK, profile), [
          'pine',
          'oak',
        ]),
      );
    }
    return map;
  };

  it('changes the models along the route instead of dressing all 5 km alike', () => {
    const placements = computePlacements({
      curve: new THREE.CatmullRomCurve3([
        new THREE.Vector3(0, 0, -200),
        new THREE.Vector3(20, 0, -100),
        new THREE.Vector3(-20, 0, 0),
        new THREE.Vector3(20, 0, 100),
        new THREE.Vector3(0, 0, 200),
      ]),
      // Enrichment that would flatten the whole route to one profile; the track
      // is what the scene should follow.
      enrichment: enrichment(['commercial', 'commercial', 'commercial']),
      resolvedByProfile: resolvedForTrack(),
      budget: 1,
      side: 'left',
      track: WILLOWBROOK_SCENERY_TRACK,
    });

    const early = new Set(placements.filter((p) => p.progress < 0.2).map((p) => p.id));
    const late = new Set(placements.filter((p) => p.progress > 0.8).map((p) => p.id));

    expect(early.size).toBeGreaterThan(0);
    expect(late.size).toBeGreaterThan(0);
    // The headwaters and the delta are different places.
    expect([...late].some((id) => !early.has(id))).toBe(true);
  });
});
