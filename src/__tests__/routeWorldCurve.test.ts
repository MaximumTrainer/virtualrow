import { describe, it, expect } from 'vitest';
import type { Coordinate } from '../lib/types/index';
import {
  routeCurvePoints,
  upsampleRouteCoordinates,
  DEFAULT_ROUTE_POINT_RESOLUTION_METERS,
} from '../lib/utils/routeWorldCurve';

/**
 * #570 AC2 — the three-free route→world-curve transform the /row route feeds
 * the WebGPU engine. Convention (from the retiring scene's gpsToScenePoints,
 * SCENE_SCALE = 1 → world metres): origin = first point; X = east; Z = negated
 * north; Y = 0.
 */
describe('routeCurvePoints (#570 AC2)', () => {
  it('returns [] for fewer than two coordinates', () => {
    expect(routeCurvePoints([])).toEqual([]);
    expect(routeCurvePoints([{ lat: 10, lng: 10 }])).toEqual([]);
  });

  it('puts the first coordinate at the origin', () => {
    const points = routeCurvePoints([
      { lat: 51.5, lng: -0.1 },
      { lat: 51.5, lng: -0.099 },
    ]);
    expect(points.length).toBeGreaterThanOrEqual(2);
    expect(points[0][0]).toBeCloseTo(0, 6);
    expect(points[0][1]).toBe(0);
    expect(points[0][2]).toBeCloseTo(0, 6);
  });

  it('maps east to +X with Z≈0 (one unit = one metre)', () => {
    // ~0.001° of longitude at the equator ≈ 111 m east.
    const points = routeCurvePoints([
      { lat: 0, lng: 0 },
      { lat: 0, lng: 0.001 },
    ]);
    const last = points[points.length - 1];
    expect(last[0]).toBeGreaterThan(100);
    expect(last[0]).toBeLessThan(120);
    expect(last[2]).toBeCloseTo(0, 3);
    expect(points.every((p) => p[1] === 0)).toBe(true);
  });

  it('maps north to −Z (the boat runs in −Z)', () => {
    const points = routeCurvePoints([
      { lat: 0, lng: 0 },
      { lat: 0.001, lng: 0 },
    ]);
    const last = points[points.length - 1];
    expect(last[2]).toBeLessThan(-100);
    expect(last[0]).toBeCloseTo(0, 3);
  });

  it('densifies a long straight leg onto the resolution grid', () => {
    // ~111 m east → ceil(111/10) ≈ 12 subdivisions → more than the 2 inputs.
    const points = routeCurvePoints([
      { lat: 0, lng: 0 },
      { lat: 0, lng: 0.001 },
    ]);
    expect(points.length).toBeGreaterThan(5);
    // X increases monotonically along a due-east leg.
    for (let i = 1; i < points.length; i++) {
      expect(points[i][0]).toBeGreaterThanOrEqual(points[i - 1][0]);
    }
  });
});

describe('upsampleRouteCoordinates', () => {
  it('leaves a route of under two points untouched', () => {
    const one: Coordinate[] = [{ lat: 1, lng: 2 }];
    expect(upsampleRouteCoordinates(one)).toBe(one);
  });

  it('keeps the endpoints and adds interior points on a long leg', () => {
    const coords: Coordinate[] = [
      { lat: 0, lng: 0 },
      { lat: 0, lng: 0.001 },
    ];
    const dense = upsampleRouteCoordinates(coords, DEFAULT_ROUTE_POINT_RESOLUTION_METERS);
    expect(dense.length).toBeGreaterThan(coords.length);
    expect(dense[0]).toEqual(coords[0]);
    expect(dense[dense.length - 1]).toEqual(coords[1]);
  });

  it('does not subdivide a leg shorter than the resolution', () => {
    // ~1 m apart — under the 10 m grid, so no interior points.
    const coords: Coordinate[] = [
      { lat: 0, lng: 0 },
      { lat: 0, lng: 0.00001 },
    ];
    expect(upsampleRouteCoordinates(coords)).toHaveLength(2);
  });
});
