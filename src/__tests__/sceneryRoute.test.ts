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
    expect(route?.pools).toHaveLength(0);
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
});
