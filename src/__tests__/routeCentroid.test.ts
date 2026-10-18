import { describe, it, expect } from 'vitest';
import { routeCentroid } from '../utils/routeCentroid';
import type { Coordinate } from '../types/index';

describe('routeCentroid', () => {
  it('returns the single coordinate for a one-point route', () => {
    const coords: Coordinate[] = [{ lat: 51.5, lng: -0.1 }];
    expect(routeCentroid(coords)).toEqual({ lat: 51.5, lng: -0.1 });
  });

  it('places the midpoint of two nearby coordinates on the great-circle line between them', () => {
    const coords: Coordinate[] = [
      { lat: 51, lng: -1 },
      { lat: 53, lng: 1 },
    ];
    const c = routeCentroid(coords);
    expect(c).not.toBeNull();
    // At these latitudes the great-circle midpoint sits within ~0.1° of the arithmetic mean.
    expect(c!.lat).toBeCloseTo(52, 1);
    expect(c!.lng).toBeCloseTo(0, 1);
  });

  it('averages across many coordinates close to the arithmetic mean at mid-latitudes', () => {
    const coords: Coordinate[] = [
      { lat: 10, lng: 20 },
      { lat: 20, lng: 30 },
      { lat: 30, lng: 40 },
      { lat: 40, lng: 50 },
    ];
    const c = routeCentroid(coords);
    expect(c).not.toBeNull();
    // Great-circle centroid differs slightly from the plain mean because
    // longitude-cosine weighting pulls high-latitude points together.
    expect(c!.lat).toBeGreaterThan(23);
    expect(c!.lat).toBeLessThan(27);
    expect(c!.lng).toBeGreaterThan(33);
    expect(c!.lng).toBeLessThan(37);
  });

  it('returns null for an empty route (D2 defines centroid over coordinates)', () => {
    expect(routeCentroid([])).toBeNull();
  });

  it('wraps longitudes across the antimeridian so a route near 180/-180 does not centre on 0', () => {
    // Two points straddling the antimeridian, one at 179°E, one at -179°E (= 181°E).
    // Naive mean gives 0; the great-circle centroid lives near ±180°.
    const coords: Coordinate[] = [
      { lat: 0, lng: 179 },
      { lat: 0, lng: -179 },
    ];
    const c = routeCentroid(coords);
    expect(c).not.toBeNull();
    expect(Math.abs(Math.abs(c!.lng) - 180)).toBeLessThan(1e-6);
  });
});
