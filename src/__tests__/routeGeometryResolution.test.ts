import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import type { Coordinate } from '../types/index';
import {
  adaptiveSegmentCount,
  createRouteCurve,
  curveLengthMeters,
  gpsToScenePoints,
  curveSegmentCount,
  getCurveDistances,
  MAX_ROUTE_SEGMENTS,
  MIN_ROUTE_SEGMENTS,
  TARGET_METERS_BETWEEN_SEGMENTS,
} from '../components/rower3d/curve';
import { SCENE_SCALE } from '../components/rower3d/constants';
import { polylineLengthMeters } from '../utils/coordinateUtils';

/** A straight north-running course of the requested real-world length. */
const straightRoute = (lengthMeters: number, points = 40): Coordinate[] => {
  const metersPerDegreeLat = 111_195;
  return Array.from({ length: points }, (_, i) => ({
    lat: 50 + (i / (points - 1)) * (lengthMeters / metersPerDegreeLat),
    lng: 0,
  }));
};

describe('adaptiveSegmentCount', () => {
  it('samples roughly every 15 m', () => {
    expect(adaptiveSegmentCount(3000)).toBe(200);
    expect(TARGET_METERS_BETWEEN_SEGMENTS).toBe(15);
  });

  it('does not drop below the floor on a sprint course', () => {
    expect(adaptiveSegmentCount(500)).toBe(MIN_ROUTE_SEGMENTS);
    expect(MIN_ROUTE_SEGMENTS).toBe(50);
  });

  it('rises with length up to the ceiling', () => {
    expect(adaptiveSegmentCount(20_000)).toBe(MAX_ROUTE_SEGMENTS);
    expect(adaptiveSegmentCount(50_000)).toBe(MAX_ROUTE_SEGMENTS);
    expect(MAX_ROUTE_SEGMENTS).toBe(800);
  });

  it('gives a marathon more geometry than a head race', () => {
    expect(adaptiveSegmentCount(6800)).toBeGreaterThan(adaptiveSegmentCount(2000));
  });

  it('falls back to the floor for a degenerate length', () => {
    expect(adaptiveSegmentCount(0)).toBe(MIN_ROUTE_SEGMENTS);
    expect(adaptiveSegmentCount(-1)).toBe(MIN_ROUTE_SEGMENTS);
    expect(adaptiveSegmentCount(Number.NaN)).toBe(MIN_ROUTE_SEGMENTS);
  });

  it('honours an explicit target spacing', () => {
    expect(adaptiveSegmentCount(3000, 30)).toBe(100);
  });
});

describe('curve length and resolution', () => {
  it('recovers the real-world route length from the scene curve', () => {
    const coordinates = straightRoute(4000);
    const curve = createRouteCurve(coordinates, SCENE_SCALE)!;
    expect(curveLengthMeters(curve)).toBeCloseTo(
      polylineLengthMeters(coordinates),
      -1,
    );
  });

  it('scales the segment count with the curve it is given', () => {
    const sprint = createRouteCurve(straightRoute(500), SCENE_SCALE)!;
    const marathon = createRouteCurve(straightRoute(20_000), SCENE_SCALE)!;

    expect(curveSegmentCount(sprint)).toBe(MIN_ROUTE_SEGMENTS);
    expect(curveSegmentCount(marathon)).toBe(MAX_ROUTE_SEGMENTS);
  });

  it('gives the distance lookup table one entry per segment plus the origin', () => {
    const curve = createRouteCurve(straightRoute(3000), SCENE_SCALE)!;
    expect(getCurveDistances(curve)).toHaveLength(curveSegmentCount(curve) + 1);
  });
});

describe('createRouteCurve simplification', () => {
  it('drops the collinear filler a straight import leaves behind', () => {
    const straight = straightRoute(2000, 200);
    const simplifiedCurve = createRouteCurve(straight, SCENE_SCALE)!;
    const rawCurve = createRouteCurve(straight, SCENE_SCALE, 10, 0)!;

    expect(simplifiedCurve.points.length).toBeLessThan(rawCurve.points.length);
  });

  it('still upsamples to the 10 m grid after simplifying', () => {
    const curve = createRouteCurve(straightRoute(2000, 200), SCENE_SCALE)!;
    // 2 km at 10 m resolution, give or take the spline's own end handling.
    expect(curve.points.length).toBeGreaterThan(150);
  });

  it('keeps the boat on the same water as the unsimplified curve', () => {
    const metersPerDegreeLat = 111_195;
    const winding: Coordinate[] = Array.from({ length: 600 }, (_, i) => {
      const t = i / 599;
      return {
        lat: 50 + (t * 3000) / metersPerDegreeLat,
        lng: (Math.sin(t * 6 * Math.PI) * 40) / (metersPerDegreeLat * Math.cos((50 * Math.PI) / 180)),
      };
    });

    const simplified = createRouteCurve(winding, SCENE_SCALE)!;
    const raw = createRouteCurve(winding, SCENE_SCALE, 10, 0)!;

    const worstDrift = Array.from({ length: 101 }, (_, i) => {
      const t = i / 100;
      return simplified.getPointAt(t).distanceTo(raw.getPointAt(t));
    }).reduce((a, b) => Math.max(a, b), 0);

    // Scene units at 0.1 scale: 0.3 units is 3 m of water.
    expect(worstDrift).toBeLessThan(0.3);
  });

  it('keeps a 10,000-point import to a spline the frame loop can afford', () => {
    // The frame loop samples this spline twice per frame, and every geometry
    // vertex samples it once more. A dense import used to hand it one control
    // point per GPS fix; the shape needs a small fraction of them (#224).
    const dense: Coordinate[] = Array.from({ length: 10_000 }, (_, i) => {
      const t = i / 9999;
      return {
        lat: 51.45 + (t * 12_000) / 111_195,
        lng: (Math.sin(t * 20 * Math.PI) * 45) / (111_195 * Math.cos((51.45 * Math.PI) / 180)),
      };
    });

    const curve = createRouteCurve(dense, SCENE_SCALE)!;
    expect(curve.points.length).toBeLessThan(dense.length / 4);

    // ...and the shape still holds: the simplified spline never strays further
    // from the imported polyline than the epsilon allows. Measured against
    // `gpsToScenePoints`, which is the projection the scene itself draws in.
    const imported = gpsToScenePoints(dense, SCENE_SCALE);
    const worstDrift = Array.from({ length: 201 }, (_, i) => {
      const point = curve.getPointAt(i / 200);
      return imported.reduce((nearest, p) => Math.min(nearest, point.distanceTo(p)), Infinity);
    }).reduce((a, b) => Math.max(a, b));

    // Scene units at 0.1 scale: 0.3 units is the 3 m simplification epsilon.
    expect(worstDrift).toBeLessThan(0.3);
  });

  it('never simplifies a route below a drawable two points', () => {
    const pair: Coordinate[] = [{ lat: 50, lng: 0 }, { lat: 50.001, lng: 0 }];
    expect(createRouteCurve(pair, SCENE_SCALE)).toBeInstanceOf(THREE.CatmullRomCurve3);
  });
});
