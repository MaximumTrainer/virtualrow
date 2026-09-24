import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  MAX_INSTANCES_PER_SIDE,
  thinToCeiling,
  budgetFor,
  keepsKitTrees,
  distinctProfiles,
  pick,
  computePlacements,
  CATEGORY_OFFSET,
  ASSET_SCALE,
  LAND_BANDS,
  bandsClearOf,
  type Category,
  type Placement,
} from '../components/rower3d/sceneryPlacement';
import {
  SCENERY_WATER_MARGIN_METRES,
  landClearance,
} from '../components/rower3d/sceneryClearance';
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

describe('the kit trees beside the billboard foliage (#333)', () => {
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0, -600),
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0, 0, 600),
  ]);
  const treeIds = new Set<string>(fallbackResolved.trees);
  const place = (kitTrees?: boolean) =>
    computePlacements({
      curve,
      enrichment: enrichment(['fallback']),
      resolvedByProfile: byProfile(),
      budget: 1,
      side: 'right',
      kitTrees,
    });

  it('keeps the GLB trees at high only, as the close-up hero trees', () => {
    expect(keepsKitTrees('high')).toBe(true);
    expect(keepsKitTrees('auto')).toBe(false);
    expect(keepsKitTrees('low')).toBe(false);
  });

  it('places the kit trees unless told not to', () => {
    expect(treeIds.size).toBeGreaterThan(0);
    expect(place().some((p) => treeIds.has(p.id))).toBe(true);
    expect(place(false).some((p) => treeIds.has(p.id))).toBe(false);
  });

  it('leaves everything else where it was when the trees go', () => {
    const withTrees = place(true).filter((p) => !treeIds.has(p.id));
    expect(place(false)).toEqual(withTrees);
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

describe('instance ceiling (#232 phase 3)', () => {
  const placementsOf = (count: number): Placement[] =>
    Array.from({ length: count }, (_, i) => ({
      id: `f0${i % 9}-model`,
      position: [0, 0, i] as [number, number, number],
      rotationY: 0,
      scale: 1,
      progress: i / (count - 1),
      footing: 'bank' as const,
    }));

  it('leaves a route inside the ceiling untouched', () => {
    const few = placementsOf(10);

    expect(thinToCeiling(few)).toEqual(few);
  });

  it('caps a long route, which is where the frame budget goes', () => {
    const many = placementsOf(MAX_INSTANCES_PER_SIDE * 3);

    expect(thinToCeiling(many).length).toBeLessThanOrEqual(MAX_INSTANCES_PER_SIDE);
  });

  it('thins evenly rather than truncating, so the far end is still dressed', () => {
    const thinned = thinToCeiling(placementsOf(MAX_INSTANCES_PER_SIDE * 3));

    expect(thinned[0].progress).toBeLessThan(0.05);
    expect(thinned[thinned.length - 1].progress).toBeGreaterThan(0.9);
  });

  it('is deterministic', () => {
    const many = placementsOf(MAX_INSTANCES_PER_SIDE * 2);

    expect(thinToCeiling(many)).toEqual(thinToCeiling(many));
  });
});

describe('each bank is placed once (review of #232)', () => {
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0, -200),
    new THREE.Vector3(10, 0, -100),
    new THREE.Vector3(-10, 0, 0),
    new THREE.Vector3(10, 0, 100),
    new THREE.Vector3(0, 0, 200),
  ]);

  const forSide = (side: 'left' | 'right') =>
    computePlacements({ curve, resolvedByProfile: byProfile(), budget: 1, side });

  it('gives the two banks different instances', () => {
    // In curve mode the loop ran `for (const sign of [-1, 1])` and ignored the
    // `side` it was given, so both <SceneryModels side=...> components computed
    // the identical array. Every object was drawn twice at the same transform:
    // double the draw calls, and z-fighting between the copies.
    const left = forSide('left');
    const right = forSide('right');

    expect(left.length).toBeGreaterThan(0);
    expect(JSON.stringify(left)).not.toEqual(JSON.stringify(right));
  });

  it('puts each side on its own bank', () => {
    // The offset is applied along the curve's perpendicular, so "which bank"
    // is the sign of the offset, not of the world x.
    const centreAt = (t: number) => curve.getPointAt(Math.min(0.999, t));
    const sideOf = (p: { position: [number, number, number]; progress: number }) => {
      const c = centreAt(p.progress);
      const tangent = curve.getTangentAt(Math.min(0.999, p.progress)).normalize();
      const perp = new THREE.Vector3().crossVectors(tangent, new THREE.Vector3(0, 1, 0)).normalize();
      return Math.sign((p.position[0] - c.x) * perp.x + (p.position[2] - c.z) * perp.z);
    };

    expect(new Set(forSide('left').map(sideOf))).toEqual(new Set([-1]));
    expect(new Set(forSide('right').map(sideOf))).toEqual(new Set([1]));
  });

  it('dresses both banks between them, as densely as before', () => {
    // The fix must not halve the scene: the two calls together should still
    // place what one call used to place for both banks.
    const total = forSide('left').length + forSide('right').length;

    expect(total).toBeGreaterThan(60);
  });
});

describe('what actually bounds the cost of a bank (review of #232)', () => {
  const longCurve = new THREE.CatmullRomCurve3(
    Array.from({ length: 40 }, (_, i) => new THREE.Vector3((i % 2 ? 30 : -30), 0, -8000 + i * 400)),
  );
  const shortCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0, -200),
    new THREE.Vector3(10, 0, 0),
    new THREE.Vector3(0, 0, 200),
  ]);

  it('samples a long route no more densely than a short one', () => {
    // MAX_INSTANCES_PER_SIDE was documented as the protection against cost
    // scaling with route length. It is not: the band count does not depend on
    // length, so the ceiling is never approached and never was.
    const long = computePlacements({ curve: longCurve, resolvedByProfile: byProfile(), budget: 1, side: 'left' });
    const short = computePlacements({ curve: shortCurve, resolvedByProfile: byProfile(), budget: 1, side: 'left' });

    expect(long.length).toBe(short.length);
    expect(long.length).toBeLessThan(MAX_INSTANCES_PER_SIDE);
  });

  it('keeps the ceiling working as a backstop if the band count is ever raised', () => {
    const many: Placement[] = Array.from({ length: MAX_INSTANCES_PER_SIDE * 3 }, (_, i) => ({
      id: 'e01-london-plane',
      position: [0, 0, i],
      rotationY: 0,
      scale: 1,
      progress: i / (MAX_INSTANCES_PER_SIDE * 3),
    })) as Placement[];

    const thinned = thinToCeiling(many);

    expect(thinned).toHaveLength(MAX_INSTANCES_PER_SIDE);
    // Thinned by stride, so the end of the route is still dressed.
    expect(thinned[thinned.length - 1].progress).toBeGreaterThan(0.6);
  });
});

describe('scenery stands clear of the water it is placed beside (#379)', () => {
  /** A route whose water is one width the whole way along. */
  const water = (widthMeters: number): RouteEnrichmentData => {
    const e = enrichment(['fallback', 'fallback', 'fallback']);
    return {
      ...e,
      waterWidthMeters: widthMeters,
      segmentProfiles: e.segmentProfiles.map((s) => ({ ...s, waterWidthMeters: widthMeters })),
    };
  };

  const straight = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0, -300),
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0, 0, 300),
  ]);

  const bothBanks = (e: RouteEnrichmentData, curve: THREE.Curve<THREE.Vector3> | null = straight) =>
    (['left', 'right'] as const).flatMap((side) =>
      computePlacements({ curve, enrichment: e, resolvedByProfile: byProfile(), budget: 1, side }),
    );

  const shift = (bands: Record<Category, [number, number]>, cat: Category) =>
    bands[cat][0] - CATEGORY_OFFSET[cat][0];

  describe('bandsClearOf', () => {
    it('keeps what belongs on the water where it was, however wide the water', () => {
      for (const halfWidth of [3.53, 10, 27.5, 60]) {
        const bands = bandsClearOf(halfWidth);
        expect(bands.surface).toEqual(CATEGORY_OFFSET.surface);
        expect(bands.inWater).toEqual(CATEGORY_OFFSET.inWater);
      }
    });

    it('lists every category that stands on the bank, innermost first', () => {
      const land = (Object.keys(CATEGORY_OFFSET) as Category[]).filter(
        (c) => c !== 'surface' && c !== 'inWater',
      );
      expect([...LAND_BANDS].sort()).toEqual(land.sort());
      const inner = LAND_BANDS.map((c) => CATEGORY_OFFSET[c][0]);
      expect(inner).toEqual([...inner].sort((a, b) => a - b));
    });

    it('moves nothing on a stream narrow enough that every band is already on land', () => {
      // 7 m, the narrowest water a real route reports, floored to 7.06 m.
      expect(bandsClearOf(7.06 / 2)).toEqual(CATEGORY_OFFSET);
    });

    it('puts the bank dressing of a 55 m river on the bank', () => {
      const bands = bandsClearOf(27.5);
      for (const cat of ['bankEdge', 'furniture', 'scatter'] as const) {
        expect(bands[cat][0], cat).toBeGreaterThanOrEqual(27.5 + SCENERY_WATER_MARGIN_METRES);
      }
    });

    it('moves a band out whole rather than squashing it against the bank', () => {
      for (const halfWidth of [10, 27.5, 60]) {
        const bands = bandsClearOf(halfWidth);
        for (const cat of LAND_BANDS) {
          const depth = CATEGORY_OFFSET[cat][1] - CATEGORY_OFFSET[cat][0];
          expect(bands[cat][1] - bands[cat][0], `${cat} at ${halfWidth}`).toBeCloseTo(depth, 9);
          expect(shift(bands, cat), `${cat} moved inwards`).toBeGreaterThanOrEqual(0);
        }
      }
    });

    it('pushes the whole arrangement out, in order, on a 120 m segment', () => {
      const bands = bandsClearOf(60);
      const inner = LAND_BANDS.map((c) => bands[c][0]);

      for (let i = 1; i < inner.length; i += 1) {
        expect(inner[i], `${LAND_BANDS[i]} is not beyond ${LAND_BANDS[i - 1]}`).toBeGreaterThan(
          inner[i - 1],
        );
      }
      expect(Math.min(...inner)).toBeGreaterThanOrEqual(60 + SCENERY_WATER_MARGIN_METRES);
    });

    it('moves the outer bands of a 20 m channel by less than a metre', () => {
      // The authored bands were drawn for this channel, and everything from the
      // scatter out was already on land. The bank edge and the furniture were
      // not - they started 4 m and 2 m inside its 10 m half-width - so those two
      // move exactly as far as the bank needs and no further.
      const bands = bandsClearOf(10);

      for (const cat of LAND_BANDS.slice(2)) {
        expect(Math.abs(shift(bands, cat)), cat).toBeLessThan(1);
      }
      expect(bands.bankEdge[0]).toBeCloseTo(10 + SCENERY_WATER_MARGIN_METRES, 9);
    });
  });

  describe('computePlacements', () => {
    it('keeps every bank placement on a 55 m river beyond 27.5 m and the margin', () => {
      const placed = bothBanks(water(55)).filter((p) => p.footing === 'bank');
      const reading = landClearance(placed, straight, water(55));

      expect(reading.count).toBeGreaterThan(20);
      expect(reading.nearestM).toBeGreaterThanOrEqual(SCENERY_WATER_MARGIN_METRES - 1e-6);
    });

    it('puts the bank dressing further out than 27.5 m on a 55 m river', () => {
      const ids = new Set([
        ...fallbackResolved.bankEdge,
        ...fallbackResolved.furniture,
        ...fallbackResolved.scatter,
      ]);
      const dressing = bothBanks(water(55)).filter((p) => ids.has(p.id));

      expect(dressing.length).toBeGreaterThan(0);
      for (const p of dressing) expect(Math.abs(p.position[0])).toBeGreaterThan(27.5);
    });

    it('clears the water on a 120 m segment, and on a curve', () => {
      const bend = new THREE.CatmullRomCurve3([
        new THREE.Vector3(0, 0, -400),
        new THREE.Vector3(150, 0, 0),
        new THREE.Vector3(0, 0, 400),
      ]);
      const placed = bothBanks(water(120), bend).filter((p) => p.footing === 'bank');

      expect(placed.length).toBeGreaterThan(20);
      expect(landClearance(placed, bend, water(120)).nearestM).toBeGreaterThanOrEqual(
        SCENERY_WATER_MARGIN_METRES - 1e-6,
      );
    });

    it('leaves what belongs on the water inside its authored band', () => {
      const afloat = bothBanks(water(120)).filter((p) => p.footing === 'water');
      const surfaceIds = new Set(fallbackResolved.surface);

      expect(afloat.length).toBeGreaterThan(0);
      for (const p of afloat) {
        expect(surfaceIds.has(p.id)).toBe(true);
        expect(Math.abs(p.position[0])).toBeLessThanOrEqual(CATEGORY_OFFSET.surface[1]);
      }
    });

    it('clears the water in flat mode too', () => {
      const e = water(55);
      const placed = (['left', 'right'] as const)
        .flatMap((side) =>
          computePlacements({ enrichment: e, resolvedByProfile: byProfile(), budget: 1, side }),
        )
        .filter((p) => p.footing === 'bank');

      expect(placed.length).toBeGreaterThan(0);
      for (const p of placed) {
        expect(Math.abs(p.position[0])).toBeGreaterThanOrEqual(27.5 + SCENERY_WATER_MARGIN_METRES);
      }
    });
  });
});
