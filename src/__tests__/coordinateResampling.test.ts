import { describe, expect, it } from 'vitest';
import {
  distanceBetweenMeters,
  polylineLengthMeters,
  resampleCoordinates,
} from '../utils/coordinateUtils';
import type { Coordinate } from '../types/index';

const maxGap = (coords: Coordinate[]) => {
  let max = 0;
  for (let i = 0; i < coords.length - 1; i++) {
    max = Math.max(max, distanceBetweenMeters(coords[i], coords[i + 1]));
  }
  return max;
};

describe('distanceBetweenMeters', () => {
  it('measures a known separation', () => {
    // 0.01 degrees of latitude is ~1.11 km anywhere on the globe.
    const d = distanceBetweenMeters({ lat: 52.0, lng: 13.0 }, { lat: 52.01, lng: 13.0 });
    expect(d).toBeGreaterThan(1100);
    expect(d).toBeLessThan(1120);
  });

  it('is zero for identical points', () => {
    expect(distanceBetweenMeters({ lat: 1, lng: 2 }, { lat: 1, lng: 2 })).toBe(0);
  });

  it('is symmetric', () => {
    const a = { lat: 48.12, lng: 11.58 };
    const b = { lat: 48.14, lng: 11.6 };
    expect(distanceBetweenMeters(a, b)).toBeCloseTo(distanceBetweenMeters(b, a), 9);
  });
});

describe('resampleCoordinates', () => {
  it('leaves sequences already dense enough untouched', () => {
    const coords = [
      { lat: 52.0, lng: 13.0 },
      { lat: 52.0001, lng: 13.0 },
    ];
    expect(resampleCoordinates(coords, 50)).toEqual(coords);
  });

  it('densifies a long segment to within the requested gap', () => {
    const coords = [
      { lat: 52.0, lng: 13.0 },
      { lat: 52.01, lng: 13.0 },
    ];
    const result = resampleCoordinates(coords, 50);
    expect(maxGap(result)).toBeLessThanOrEqual(50);
    expect(result.length).toBeGreaterThan(20);
  });

  it('preserves the original endpoints exactly', () => {
    const coords = [
      { lat: 52.0, lng: 13.0 },
      { lat: 52.05, lng: 13.02 },
    ];
    const result = resampleCoordinates(coords, 50);
    expect(result[0]).toEqual(coords[0]);
    expect(result[result.length - 1]).toEqual(coords[1]);
  });

  it('keeps every original point, in order', () => {
    const coords = [
      { lat: 52.0, lng: 13.0 },
      { lat: 52.01, lng: 13.01 },
      { lat: 52.02, lng: 13.0 },
    ];
    const result = resampleCoordinates(coords, 50);
    for (const original of coords) {
      expect(result).toContainEqual(original);
    }
    expect(result.indexOf(coords[0])).toBeLessThan(result.indexOf(coords[1]));
    expect(result.indexOf(coords[1])).toBeLessThan(result.indexOf(coords[2]));
  });

  it('does not invent bends — interpolated points stay on the source segment', () => {
    const start = { lat: 52.0, lng: 13.0 };
    const end = { lat: 52.02, lng: 13.0 };
    const result = resampleCoordinates([start, end], 50);
    // A due-north segment must stay at a constant longitude.
    for (const point of result) {
      expect(point.lng).toBeCloseTo(13.0, 10);
    }
  });

  it('preserves overall length within a tolerance', () => {
    const coords = [
      { lat: 52.0, lng: 13.0 },
      { lat: 52.03, lng: 13.04 },
    ];
    const before = polylineLengthMeters(coords);
    const after = polylineLengthMeters(resampleCoordinates(coords, 50));
    expect(Math.abs(after - before) / before).toBeLessThan(0.001);
  });

  it('returns short or invalid input unchanged', () => {
    expect(resampleCoordinates([], 50)).toEqual([]);
    const single = [{ lat: 1, lng: 2 }];
    expect(resampleCoordinates(single, 50)).toEqual(single);
    const pair = [{ lat: 1, lng: 2 }, { lat: 3, lng: 4 }];
    expect(resampleCoordinates(pair, 0)).toEqual(pair);
    expect(resampleCoordinates(pair, Number.NaN)).toEqual(pair);
  });

  it('reaches demo-route density for a 2-gate course the size of rownative course 1 (issue #189 RF-1)', () => {
    // rownative course 1 is 5,306 m expressed as just two gate centroids.
    // 5,306 m is ~0.04766 degrees of latitude.
    const gates = [
      { lat: 42.24, lng: -71.81 },
      { lat: 42.24 + 0.04766, lng: -71.81 },
    ];
    const span = distanceBetweenMeters(gates[0], gates[1]);
    expect(span).toBeGreaterThan(5250);
    expect(span).toBeLessThan(5350);

    const result = resampleCoordinates(gates, 50);
    expect(maxGap(result)).toBeLessThanOrEqual(50);
    // One point per <=50 m across 5.3 km, plus the closing point.
    expect(result.length).toBe(Math.ceil(span / 50) + 1);
    expect(result.length).toBeGreaterThanOrEqual(100);
  });
});
