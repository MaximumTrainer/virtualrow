import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { RouteCurve } from '../../renderer/math/curve';
import { vec3 } from '../../renderer/math/vec3';
import {
  computeStructurePlacements,
  courseStructures,
  landmarkStructures,
  routeStructures,
  LIVERIED_LANDMARKS,
} from '../sceneryStructures';
import {
  courseStructures as reactCourseStructures,
  landmarkStructures as reactLandmarkStructures,
  computeStructurePlacements as reactComputeStructurePlacements,
} from '../../../components/rower3d/sceneryStructures';

describe('sceneryStructures parity with React', () => {
  const points: readonly [number, number, number][] = [
    [0, 0, 0], [0, 0, -200], [0, 0, -400], [0, 0, -600], [0, 0, -800], [0, 0, -1000],
  ];
  const engineCurve = new RouteCurve(points.map(([x, y, z]) => vec3(x, y, z)), false);
  const threeCurve = new THREE.CatmullRomCurve3(
    points.map(([x, y, z]) => new THREE.Vector3(x, y, z)),
    false, 'catmullrom', 0.5,
  );

  it('courseStructures agrees with the React port on a 2 km route', () => {
    const ours = courseStructures(2000);
    const theirs = reactCourseStructures(2000);
    expect(ours.length).toBe(theirs.length);
    for (let i = 0; i < ours.length; i += 1) {
      expect(ours[i].id).toBe(theirs[i].id);
      expect(ours[i].progress).toBeCloseTo(theirs[i].progress, 6);
      expect(ours[i].kind).toBe(theirs[i].kind);
    }
  });

  it('landmarkStructures matches on the Barnes bridge pass', () => {
    const barnes = LIVERIED_LANDMARKS[0];
    const coords = [
      { lat: barnes.at.lat + 0.001, lng: barnes.at.lng + 0.001 },
      { lat: barnes.at.lat, lng: barnes.at.lng },
      { lat: barnes.at.lat - 0.001, lng: barnes.at.lng - 0.001 },
    ];
    const ours = landmarkStructures(coords);
    const theirs = reactLandmarkStructures(coords);
    expect(ours).toEqual(theirs);
  });

  it('computeStructurePlacements produces placements on both sides of the curve', () => {
    const requests = courseStructures(2000);
    const ours = computeStructurePlacements(engineCurve, requests, null, null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const theirs = reactComputeStructurePlacements(threeCurve as any, requests, null, null);
    expect(ours.length).toBe(theirs.length);
    for (let i = 0; i < ours.length; i += 1) {
      expect(ours[i].id).toBe(theirs[i].id);
      expect(Math.abs(ours[i].position[0] - theirs[i].position[0])).toBeLessThan(1);
      expect(Math.abs(ours[i].position[2] - theirs[i].position[2])).toBeLessThan(1);
      expect(ours[i].footing).toBe(theirs[i].footing);
    }
  });

  it('computeStructurePlacements covers bridge / landmark / buoy footings', () => {
    const requests = [
      { id: 'test-bridge', progress: 0.25, kind: 'bridge' as const },
      { id: 'test-landmark', progress: 0.5, kind: 'landmark' as const, side: 'left' as const },
      { id: 'test-buoy', progress: 0.75, kind: 'buoy' as const, side: 'right' as const },
      { id: 'test-furn', progress: 0.9, kind: 'furniture' as const },
    ];
    const placements = computeStructurePlacements(engineCurve, requests, null, null);
    expect(placements[0].footing).toBe('water'); // bridge spans the water
    expect(placements[1].footing).toBe('bank');  // landmark on bank
    expect(placements[2].footing).toBe('water'); // buoy floats
    expect(placements[3].footing).toBe('bank');  // furniture on bank
  });

  it('computeStructurePlacements returns [] on a null curve', () => {
    expect(computeStructurePlacements(null, [], null, null)).toEqual([]);
  });

  it('landmarkStructures returns [] when the route is too far from every landmark', () => {
    const far = [
      { lat: 0, lng: 0 },
      { lat: 0, lng: 0.001 },
      { lat: 0, lng: 0.002 },
    ];
    expect(landmarkStructures(far)).toEqual([]);
    // And on a degenerate route (<2 points) it also returns [].
    expect(landmarkStructures([])).toEqual([]);
    expect(landmarkStructures([{ lat: 0, lng: 0 }])).toEqual([]);
  });

  it('routeStructures short-circuits on the right bank and when the scene has no curve', () => {
    expect(routeStructures({ side: 'right', hasCurve: true, routeMeters: 1000 })).toEqual([]);
    expect(routeStructures({ side: 'left', hasCurve: false, routeMeters: 1000 })).toEqual([]);
    const left = routeStructures({ side: 'left', hasCurve: true, routeMeters: 1000, crossings: null, coordinates: null });
    expect(left.length).toBeGreaterThan(0);
  });
});
