import { describe, it, expect } from 'vitest';
import type { WaterRoute } from '../lib/types/index';
import { toEngineRoute } from '../lib/ui/sceneryRoute';

/**
 * #570 AC2 — the shell route → engine SceneryRoute adapter. The engine only
 * acts on a route that is a `SceneryRoute` (has a `pools` array); the adapter
 * gives it that plus the curve + real length so the boat follows the route.
 */
const makeRoute = (over: Partial<WaterRoute> = {}): WaterRoute =>
  ({
    id: 'r1',
    name: 'Test',
    description: '',
    distance: 2, // km
    difficulty: 'easy',
    location: '',
    coordinates: [
      { lat: 0, lng: 0 },
      { lat: 0, lng: 0.001 },
    ],
    elevationGain: 0,
    estimatedTime: 10,
    tags: [],
    createdAt: new Date(),
    ...over,
  }) as WaterRoute;

describe('toEngineRoute (#570 AC2)', () => {
  it('returns null when no route is selected', () => {
    expect(toEngineRoute(null)).toBeNull();
    expect(toEngineRoute(undefined)).toBeNull();
  });

  it('always carries a pools array so isSceneryRoute holds', () => {
    const route = toEngineRoute(makeRoute());
    expect(Array.isArray(route?.pools)).toBe(true);
    // The adapter populates foliage pools when the curve is well-formed; the
    // engine mounts an empty scenery pass for an empty `pools`, which is the
    // path taken when the curve is too short — tested below.
    for (const pool of route?.pools ?? []) {
      expect(pool.kind).toBe('foliage');
      expect(pool.positions.length % 3).toBe(0);
      expect(pool.metadata?.length).toBe(pool.positions.length / 3);
    }
  });

  it('leaves pools empty when the route has too few coordinates to form a curve', () => {
    const route = toEngineRoute(makeRoute({ coordinates: [{ lat: 1, lng: 1 }] }));
    expect(route?.pools).toHaveLength(0);
  });

  it('scales GLB scenery with the device tier (kit trees arrive at high)', () => {
    // Low/basic/medium: `keepsKitTrees` is false, so the GLB kit-tree species
    // are suppressed in `computePlacements`. High/extra-high flips both the
    // budget (0.85 vs 0.5-0.7) and `kitTrees` to true, giving a larger
    // sceneryGlbs set. The invariant we assert is "high >= medium >= low" so
    // the test keeps working if the scenery catalogue grows.
    const base = makeRoute();
    const low = toEngineRoute(base, undefined, 'low');
    const medium = toEngineRoute(base, undefined, 'medium');
    const high = toEngineRoute(base, undefined, 'high');
    const count = (r: ReturnType<typeof toEngineRoute>) =>
      (r?.sceneryGlbs ?? []).reduce((n, g) => n + g.instances.length, 0);
    expect(count(high)).toBeGreaterThanOrEqual(count(medium));
    expect(count(medium)).toBeGreaterThanOrEqual(count(low));
    expect(count(high)).toBeGreaterThan(count(low));
    // Foliage pools (sprite + solid tree layout) come from `foliagePlan`
    // which is deterministic regardless of tier, so pool counts match.
    expect((high?.pools ?? []).length).toBe((low?.pools ?? []).length);
  });

  it('places more foliage on a longer route (deterministic density scales with length)', () => {
    const short = toEngineRoute(makeRoute({
      coordinates: [
        { lat: 0, lng: 0 },
        { lat: 0, lng: 0.001 },
      ],
      distance: 0.1, // 100 m
    }));
    const long = toEngineRoute(makeRoute({
      coordinates: [
        { lat: 0, lng: 0 },
        { lat: 0, lng: 0.01 },
      ],
      distance: 1, // 1 km
    }));
    const shortCount = (short?.pools ?? []).reduce((n, p) => n + p.positions.length / 3, 0);
    const longCount = (long?.pools ?? []).reduce((n, p) => n + p.positions.length / 3, 0);
    expect(longCount).toBeGreaterThan(shortCount);
  });

  it('derives curvePoints from the route geometry', () => {
    const route = toEngineRoute(makeRoute());
    expect(route?.curvePoints?.length).toBeGreaterThanOrEqual(2);
    const first = route?.curvePoints?.[0] ?? [NaN, NaN, NaN];
    expect(first[0]).toBeCloseTo(0, 6);
    expect(first[1]).toBe(0);
    expect(first[2]).toBeCloseTo(0, 6);
  });

  it('sets totalDistanceMeters to distance × 1000 (matches finish detection)', () => {
    const route = toEngineRoute(makeRoute({ distance: 2 }));
    expect(route?.totalDistanceMeters).toBe(2000);
  });

  it('omits totalDistanceMeters for a zero-length route (engine uses chord length)', () => {
    const route = toEngineRoute(makeRoute({ distance: 0 }));
    expect(route?.totalDistanceMeters).toBeUndefined();
    expect(Array.isArray(route?.pools)).toBe(true);
  });

  it('omits curvePoints but still mounts for a route with too few points', () => {
    const route = toEngineRoute(makeRoute({ coordinates: [{ lat: 1, lng: 1 }] }));
    expect(route?.curvePoints).toBeUndefined();
    expect(route?.pools).toHaveLength(0);
    expect(route?.totalDistanceMeters).toBe(2000);
  });

  it('treats a route with no coordinates as an empty curve, still mounting', () => {
    const route = toEngineRoute(makeRoute({ coordinates: undefined as never }));
    expect(route?.curvePoints).toBeUndefined();
    expect(Array.isArray(route?.pools)).toBe(true);
    expect(route?.totalDistanceMeters).toBe(2000);
  });

  it('marks a lap route as closed when the endpoints are within 5 m', () => {
    const lap = makeRoute({
      coordinates: [
        { lat: 0, lng: 0 },
        { lat: 0.001, lng: 0 },
        { lat: 0.001, lng: 0.001 },
        { lat: 0.000001, lng: 0.000001 }, // ~15 cm from the start
      ],
    });
    expect(toEngineRoute(lap)?.isClosedLoop).toBe(true);
    const open = makeRoute({
      coordinates: [
        { lat: 0, lng: 0 },
        { lat: 0, lng: 0.001 },
        { lat: 0.001, lng: 0.001 },
        { lat: 0.001, lng: 0.002 },
      ],
    });
    // Open routes carry no isClosedLoop at all so the engine's default (false) applies.
    expect(toEngineRoute(open)?.isClosedLoop).toBeUndefined();
    // Too-short routes can't be loops regardless of endpoint proximity.
    expect(toEngineRoute(makeRoute())?.isClosedLoop).toBeUndefined();
  });

  it('always publishes waterEdgesForProgress, with a sensible fallback when there is no enrichment', () => {
    const route = toEngineRoute(makeRoute());
    const edges = route?.waterEdgesForProgress?.(0.5);
    // Fallback width is 20 m / 2 on each side, floored at MIN_NAVIGABLE_WIDTH_METERS / 2.
    expect(edges?.left).toBeGreaterThan(0);
    expect(edges?.left).toBeCloseTo(edges?.right ?? 0);
  });

  it('uses enrichment-derived shore widths when enrichment is supplied', () => {
    const enriched = toEngineRoute(makeRoute(), {
      source: 'overpass',
      enrichedAt: 0,
      segmentProfiles: [
        {
          waterBodyType: 'river',
          waterWidthMeters: 40,
          leftShoreMeters: 5,
          rightShoreMeters: 35,
          waterBodyName: null,
          dragModifier: 1,
          elevationMeters: 0,
          windModifier: 1,
          onMappedWater: true,
          mappedWaterType: 'river',
          mappedWaterSource: 'overpass',
          sceneryProfile: 'fallback',
        },
        {
          waterBodyType: 'river',
          waterWidthMeters: 40,
          leftShoreMeters: 5,
          rightShoreMeters: 35,
          waterBodyName: null,
          dragModifier: 1,
          elevationMeters: 0,
          windModifier: 1,
          onMappedWater: true,
          mappedWaterType: 'river',
          mappedWaterSource: 'overpass',
          sceneryProfile: 'fallback',
        },
      ],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    const mid = enriched?.waterEdgesForProgress?.(0.5);
    expect(mid?.left).toBeCloseTo(5);
    expect(mid?.right).toBeCloseTo(35);
  });
});
