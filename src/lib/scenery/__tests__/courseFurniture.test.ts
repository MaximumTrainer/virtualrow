import { describe, expect, it } from 'vitest';
import { RouteCurve } from '../../renderer/math/curve';
import { vec3 } from '../../renderer/math/vec3';
import {
  courseFurniture,
  placeFurniture,
  DISTANCE_POST_INTERVAL_METERS,
  MAX_DISTANCE_POSTS,
} from '../courseFurniture';
import { courseFurniture as reactCourseFurniture } from '../../../components/rower3d/courseFurniture';

describe('courseFurniture parity with React', () => {
  it('matches tree-for-tree on a 2 km route', () => {
    const ours = courseFurniture(2000);
    const theirs = reactCourseFurniture(2000);
    expect(ours).toEqual(theirs);
  });

  it('matches on a long course that trips the MAX_DISTANCE_POSTS cap', () => {
    const long = DISTANCE_POST_INTERVAL_METERS * (MAX_DISTANCE_POSTS * 2 + 3);
    const ours = courseFurniture(long);
    const theirs = reactCourseFurniture(long);
    expect(ours).toEqual(theirs);
    const posts = ours.filter((f) => f.id === 'a07-distance-marker-post').length;
    expect(posts).toBeLessThanOrEqual(MAX_DISTANCE_POSTS);
  });

  it('returns [] for a zero- or negative-length course', () => {
    expect(courseFurniture(0)).toEqual([]);
    expect(courseFurniture(-5)).toEqual([]);
    expect(courseFurniture(Number.NaN)).toEqual([]);
  });
});

describe('placeFurniture', () => {
  it('puts a buoy either side of the start and the finish', () => {
    const curve = new RouteCurve([vec3(0, 0, 0), vec3(0, 0, -1000)], false);
    const placements = placeFurniture({ curve, routeMeters: 1000 });
    const startLeftBuoy = placements.find((p) => p.progress === 0 && p.side === 'left');
    const startRightBuoy = placements.find((p) => p.progress === 0 && p.side === 'right');
    expect(startLeftBuoy?.kind).toBe('buoy');
    expect(startRightBuoy?.kind).toBe('buoy');
    // Buoys sit at ±BUOY_LANE_HALF_WIDTH_METRES either side of the centreline.
    expect(startLeftBuoy?.position[0]).toBeCloseTo(-6.5, 3);
    expect(startRightBuoy?.position[0]).toBeCloseTo(6.5, 3);
  });

  it('places the finish tower at progress=1 on the right bank', () => {
    const curve = new RouteCurve([vec3(0, 0, 0), vec3(0, 0, -1000)], false);
    const placements = placeFurniture({ curve, routeMeters: 1000 });
    const tower = placements.find((p) => p.id === 'a06-finish-tower');
    expect(tower?.progress).toBe(1);
    expect(tower?.side).toBe('right');
    expect(tower?.position[0]).toBeGreaterThan(0); // right bank
  });
});
