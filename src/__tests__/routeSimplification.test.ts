import { describe, it, expect } from 'vitest';
import type { Coordinate } from '../types/index';
import {
  bearingRadians,
  distanceBetweenMeters,
  simplifyCoordinates,
  polylineLengthMeters,
  resampleCoordinates,
  EARTH_RADIUS_M,
  DEFAULT_SIMPLIFY_EPSILON_METERS,
} from '../utils/coordinateUtils';

/**
 * Shortest distance in metres from `point` to the great-circle segment
 * `start`→`end` — the exact spherical measure, spelled out here as an
 * independent oracle for the deviation `simplifyCoordinates` promises.
 *
 * The simplifier itself works on a local metre plane, which is far faster and
 * agrees with this to well under a millimetre at course scale. Checking the
 * fast implementation against the slow exact one is the whole point of keeping
 * this here rather than in `src/`.
 */
const clampToUnitInterval = (value: number) => Math.max(-1, Math.min(1, value));

const geodesicDistanceToSegment = (
  point: Coordinate,
  start: Coordinate,
  end: Coordinate,
): number => {
  const toPoint = distanceBetweenMeters(start, point);
  const segmentLength = distanceBetweenMeters(start, end);
  if (segmentLength === 0 || toPoint === 0) return toPoint;

  const bearingDelta = bearingRadians(start, point) - bearingRadians(start, end);
  if (Math.cos(bearingDelta) <= 0) return toPoint;

  const angularToPoint = toPoint / EARTH_RADIUS_M;
  const crossTrack = Math.asin(
    clampToUnitInterval(Math.sin(angularToPoint) * Math.sin(bearingDelta)),
  );
  const alongTrack = Math.acos(
    clampToUnitInterval(Math.cos(angularToPoint) / Math.cos(crossTrack)),
  );
  if (alongTrack * EARTH_RADIUS_M > segmentLength) return distanceBetweenMeters(point, end);

  return Math.abs(crossTrack) * EARTH_RADIUS_M;
};

/**
 * One-sided Hausdorff distance from `original` to the polyline `simplified`:
 * the worst any original point strays from the shape that replaced it. This is
 * the number the simplifier's epsilon is supposed to bound (#224).
 */
const maxDeviationMeters = (original: Coordinate[], simplified: Coordinate[]): number =>
  Math.max(
    ...original.map((point) =>
      Math.min(
        ...simplified
          .slice(0, -1)
          .map((start, i) => geodesicDistanceToSegment(point, start, simplified[i + 1])),
      ),
    ),
  );

/** A serpentine course: `bends` full sine waves of `amplitudeMeters` swing. */
const serpentine = (points: number, bends: number, amplitudeMeters: number): Coordinate[] => {
  const metersPerDegreeLat = 111_195;
  return Array.from({ length: points }, (_, i) => {
    const t = i / (points - 1);
    return {
      lat: 50 + (t * 2000) / metersPerDegreeLat,
      lng:
        (Math.sin(t * bends * 2 * Math.PI) * amplitudeMeters) /
        (metersPerDegreeLat * Math.cos((50 * Math.PI) / 180)),
    };
  });
};

describe('the geodesic oracle these tests measure deviation with', () => {
  it('is zero for a point lying on the segment', () => {
    // A meridian is a great circle, so the midpoint is exactly on the segment.
    const start: Coordinate = { lat: 50, lng: 0 };
    const end: Coordinate = { lat: 50.01, lng: 0 };
    const middle: Coordinate = { lat: 50.005, lng: 0 };
    expect(geodesicDistanceToSegment(middle, start, end)).toBeLessThan(0.001);
  });

  it('sees the bulge between a constant-latitude line and the great circle', () => {
    // Rowing east along 50°N is a rhumb line, which bows south of the geodesic.
    // A degree-space perpendicular would call this zero.
    const offCircle = geodesicDistanceToSegment(
      { lat: 50, lng: 0.005 },
      { lat: 50, lng: 0 },
      { lat: 50, lng: 0.01 },
    );
    expect(offCircle).toBeGreaterThan(0);
    expect(offCircle).toBeLessThan(0.05);
  });

  it('measures the perpendicular offset, not the distance to the endpoints', () => {
    // ~111 m north of the midpoint of a 716 m east-west segment.
    const start: Coordinate = { lat: 50, lng: 0 };
    const end: Coordinate = { lat: 50, lng: 0.01 };
    const offset: Coordinate = { lat: 50.001, lng: 0.005 };
    expect(geodesicDistanceToSegment(offset, start, end)).toBeCloseTo(111, 0);
  });

  it('falls back to the endpoint distance when the point projects past the segment', () => {
    const start: Coordinate = { lat: 50, lng: 0 };
    const end: Coordinate = { lat: 50, lng: 0.01 };
    const beyond: Coordinate = { lat: 50, lng: 0.02 };
    expect(geodesicDistanceToSegment(beyond, start, end)).toBeCloseTo(
      distanceBetweenMeters(beyond, end),
      3,
    );
  });

  it('falls back to the start distance when the point projects behind the segment', () => {
    const start: Coordinate = { lat: 50, lng: 0 };
    const end: Coordinate = { lat: 50, lng: 0.01 };
    const behind: Coordinate = { lat: 50, lng: -0.01 };
    expect(geodesicDistanceToSegment(behind, start, end)).toBeCloseTo(
      distanceBetweenMeters(behind, start),
      3,
    );
  });

  it('treats a degenerate segment as a single point', () => {
    const point: Coordinate = { lat: 50.001, lng: 0 };
    const same: Coordinate = { lat: 50, lng: 0 };
    expect(geodesicDistanceToSegment(point, same, same)).toBeCloseTo(
      distanceBetweenMeters(point, same),
      6,
    );
  });

  it('is geodesic, not degree-Euclidean: a degree of longitude shrinks with latitude', () => {
    // The same longitude offset is a much shorter real distance near the pole.
    const atEquator = geodesicDistanceToSegment(
      { lat: 0, lng: 0.001 },
      { lat: -0.01, lng: 0 },
      { lat: 0.01, lng: 0 },
    );
    const atSixty = geodesicDistanceToSegment(
      { lat: 60, lng: 0.001 },
      { lat: 59.99, lng: 0 },
      { lat: 60.01, lng: 0 },
    );
    expect(atSixty).toBeLessThan(atEquator * 0.55);
  });
});

describe('simplifyCoordinates', () => {
  it('keeps sequences shorter than three points unchanged', () => {
    const pair: Coordinate[] = [{ lat: 50, lng: 0 }, { lat: 50, lng: 0.01 }];
    expect(simplifyCoordinates(pair)).toEqual(pair);
    expect(simplifyCoordinates([])).toEqual([]);
  });

  it('collapses a straight run to its endpoints', () => {
    const straight = resampleCoordinates(
      [{ lat: 50, lng: 0 }, { lat: 50, lng: 0.05 }],
      50,
    );
    expect(straight.length).toBeGreaterThan(60);
    expect(simplifyCoordinates(straight, 3)).toHaveLength(2);
  });

  it('always preserves the first and last point exactly', () => {
    const track = serpentine(400, 6, 40);
    const simplified = simplifyCoordinates(track, 3);
    expect(simplified[0]).toEqual(track[0]);
    expect(simplified[simplified.length - 1]).toEqual(track[track.length - 1]);
  });

  it('keeps a bend that swings further than the epsilon', () => {
    const bend: Coordinate[] = [
      { lat: 50, lng: 0 },
      { lat: 50.0005, lng: 0.005 }, // ~55 m off the chord
      { lat: 50, lng: 0.01 },
    ];
    expect(simplifyCoordinates(bend, 3)).toHaveLength(3);
  });

  it('drops a wobble smaller than the epsilon', () => {
    const wobble: Coordinate[] = [
      { lat: 50, lng: 0 },
      { lat: 50.000009, lng: 0.005 }, // ~1 m off the chord
      { lat: 50, lng: 0.01 },
    ];
    expect(simplifyCoordinates(wobble, 3)).toHaveLength(2);
  });

  it('holds a serpentine course within the epsilon it was given', () => {
    const track = serpentine(2000, 8, 60);
    const simplified = simplifyCoordinates(track, 3);

    expect(simplified.length).toBeLessThan(track.length);
    expect(maxDeviationMeters(track, simplified)).toBeLessThanOrEqual(3);
  });

  it('removes most points from a track whose bends are gentler than the epsilon', () => {
    // A 50 m-resampled import: the interpolated points are collinear filler.
    const imported = resampleCoordinates(serpentine(40, 2, 120), 50);
    const simplified = simplifyCoordinates(imported, DEFAULT_SIMPLIFY_EPSILON_METERS);
    expect(simplified.length).toBeLessThan(imported.length * 0.6);
  });

  it('preserves route length to within a fraction of a percent', () => {
    const track = serpentine(2000, 8, 60);
    const simplified = simplifyCoordinates(track, 3);
    const before = polylineLengthMeters(track);
    const after = polylineLengthMeters(simplified);
    expect(Math.abs(after - before) / before).toBeLessThan(0.01);
  });

  it('keeps the shape of a closed loop, whose ends coincide', () => {
    const loop: Coordinate[] = Array.from({ length: 361 }, (_, i) => {
      const angle = (i * Math.PI) / 180;
      return { lat: 50 + Math.cos(angle) * 0.005, lng: Math.sin(angle) * 0.005 };
    });
    const simplified = simplifyCoordinates(loop, 3);
    expect(simplified.length).toBeGreaterThan(20);
    expect(maxDeviationMeters(loop, simplified)).toBeLessThanOrEqual(3);
  });

  it('returns the input untouched for a non-positive epsilon', () => {
    const track = serpentine(50, 2, 40);
    expect(simplifyCoordinates(track, 0)).toBe(track);
  });

  it('simplifies a 20,000-point track without exhausting the call stack', () => {
    const huge = serpentine(20_000, 40, 80);
    expect(() => simplifyCoordinates(huge, 3)).not.toThrow();
    expect(simplifyCoordinates(huge, 3).length).toBeLessThan(huge.length);
  });
});
