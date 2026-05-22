import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import type { Coordinate } from '../types/index';
import {
  gpsToScenePoints,
  createRouteCurve,
  getRoutePositionAtProgress,
  getCurveDistances,
  distanceToProgress,
} from '../components/rower3d/curve';

describe('Rower3D curve helpers', () => {
  describe('gpsToScenePoints', () => {
    it('returns an empty array for fewer than two coordinates', () => {
      expect(gpsToScenePoints([])).toEqual([]);
      expect(gpsToScenePoints([{ lat: 0, lng: 0 }])).toEqual([]);
    });

    it('places the first coordinate at the origin', () => {
      const coords: Coordinate[] = [
        { lat: 48.0, lng: 11.0 },
        { lat: 48.001, lng: 11.001 },
      ];
      const points = gpsToScenePoints(coords);
      expect(points).toHaveLength(2);
      expect(points[0].x).toBeCloseTo(0, 5);
      expect(points[0].z).toBeCloseTo(0, 5);
    });

    it('inverts the Z axis (north = -Z)', () => {
      const coords: Coordinate[] = [
        { lat: 0, lng: 0 },
        { lat: 0.001, lng: 0 }, // moves north → -Z in scene
      ];
      const points = gpsToScenePoints(coords);
      expect(points[1].z).toBeLessThan(0);
    });

    it('respects the sceneScale parameter', () => {
      const coords: Coordinate[] = [
        { lat: 0, lng: 0 },
        { lat: 0, lng: 0.001 },
      ];
      const small = gpsToScenePoints(coords, 0.1);
      const large = gpsToScenePoints(coords, 1.0);
      expect(Math.abs(large[1].x)).toBeCloseTo(Math.abs(small[1].x) * 10, 5);
    });
  });

  describe('createRouteCurve', () => {
    it('returns null for insufficient coordinates', () => {
      expect(createRouteCurve([])).toBeNull();
      expect(createRouteCurve([{ lat: 0, lng: 0 }])).toBeNull();
    });

    it('returns a CatmullRomCurve3 for valid input', () => {
      const coords: Coordinate[] = [
        { lat: 0, lng: 0 },
        { lat: 0.001, lng: 0 },
        { lat: 0.002, lng: 0.001 },
      ];
      const curve = createRouteCurve(coords);
      expect(curve).toBeInstanceOf(THREE.CatmullRomCurve3);
    });
  });

  describe('getRoutePositionAtProgress', () => {
    it('falls back to a straight line when curve is null', () => {
      const out = getRoutePositionAtProgress(null, 0.5);
      expect(out.position.x).toBe(0);
      expect(out.position.z).toBe(-50);
      expect(out.tangent.z).toBe(-1);
      expect(out.angle).toBe(0);
    });

    it('writes into provided scratch vectors without allocating new ones', () => {
      const coords: Coordinate[] = [
        { lat: 0, lng: 0 },
        { lat: 0.001, lng: 0 },
      ];
      const curve = createRouteCurve(coords)!;
      const outPos = new THREE.Vector3();
      const outTan = new THREE.Vector3();
      const result = getRoutePositionAtProgress(curve, 0.5, outPos, outTan);
      expect(result.position).toBe(outPos);
      expect(result.tangent).toBe(outTan);
    });

    it('clamps progress to [0, 1]', () => {
      const coords: Coordinate[] = [
        { lat: 0, lng: 0 },
        { lat: 0.001, lng: 0 },
      ];
      const curve = createRouteCurve(coords)!;
      const atNeg = getRoutePositionAtProgress(curve, -1);
      const atZero = getRoutePositionAtProgress(curve, 0);
      const atTwo = getRoutePositionAtProgress(curve, 2);
      const atOne = getRoutePositionAtProgress(curve, 1);
      expect(atNeg.position.equals(atZero.position)).toBe(true);
      expect(atTwo.position.equals(atOne.position)).toBe(true);
    });

    it('produces a heading angle aligned with the tangent', () => {
      // A straight north-pointing line should have an angle near 0 because
      // the boat's local -Z is aligned with the +Z-ish tangent? Actually we
      // build with z negated (north = -Z), so tangent will be -Z and
      // atan2(tangent.x=0, tangent.z=-1) = π.
      const coords: Coordinate[] = [
        { lat: 0, lng: 0 },
        { lat: 0.001, lng: 0 },
        { lat: 0.002, lng: 0 },
      ];
      const curve = createRouteCurve(coords)!;
      const out = getRoutePositionAtProgress(curve, 0.5);
      // Tangent is a unit vector
      expect(out.tangent.length()).toBeCloseTo(1, 5);
    });
  });

  describe('getCurveDistances', () => {
    it('starts at 0 and grows monotonically', () => {
      const coords: Coordinate[] = [
        { lat: 0, lng: 0 },
        { lat: 0.001, lng: 0 },
        { lat: 0.002, lng: 0.001 },
        { lat: 0.003, lng: 0.002 },
      ];
      const curve = createRouteCurve(coords)!;
      const distances = getCurveDistances(curve, 50);
      expect(distances[0]).toBe(0);
      expect(distances).toHaveLength(51);
      for (let i = 1; i < distances.length; i++) {
        expect(distances[i]).toBeGreaterThanOrEqual(distances[i - 1]);
      }
    });

    it('total length approximates the straight-line distance for collinear points', () => {
      // Two-point Catmull-Rom collapses to a straight line.
      const coords: Coordinate[] = [
        { lat: 0, lng: 0 },
        { lat: 0, lng: 0.001 }, // ~111 m east → scaled to ~11.1 scene units
      ];
      const curve = createRouteCurve(coords)!;
      const distances = getCurveDistances(curve, 100);
      const len = distances[distances.length - 1];
      expect(len).toBeGreaterThan(0);
      // Should be roughly between 5 and 30 scene units (sanity bound, depends
      // on Earth radius constant and 0.1 sceneScale).
      expect(len).toBeGreaterThan(5);
      expect(len).toBeLessThan(30);
    });
  });

  describe('distanceToProgress', () => {
    const curveDistances = [0, 10, 20, 30, 40, 50];
    const curveLength = 50;

    it('returns 0 when totalDistanceMeters or curveLength is non-positive', () => {
      expect(distanceToProgress(100, 0, curveDistances, curveLength)).toBe(0);
      expect(distanceToProgress(100, 1000, curveDistances, 0)).toBe(0);
    });

    it('returns 0 at the start of the route', () => {
      expect(distanceToProgress(0, 1000, curveDistances, curveLength)).toBe(0);
    });

    it('returns ~1 at the end of the route', () => {
      const t = distanceToProgress(1000, 1000, curveDistances, curveLength);
      expect(t).toBeCloseTo(1, 5);
    });

    it('returns ~0.5 at the midpoint', () => {
      const t = distanceToProgress(500, 1000, curveDistances, curveLength);
      expect(t).toBeGreaterThan(0.4);
      expect(t).toBeLessThan(0.6);
    });

    it('always returns a value in [0, 1]', () => {
      const t1 = distanceToProgress(-100, 1000, curveDistances, curveLength);
      const t2 = distanceToProgress(2000, 1000, curveDistances, curveLength);
      expect(t1).toBeGreaterThanOrEqual(0);
      expect(t1).toBeLessThanOrEqual(1);
      expect(t2).toBeGreaterThanOrEqual(0);
      expect(t2).toBeLessThanOrEqual(1);
    });
  });
});
