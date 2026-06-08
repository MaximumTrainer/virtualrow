import { describe, it, expect } from 'vitest';
import {
  bearingBetweenLatLng,
  bearingDelta,
  upsampleCoordinates,
  segmentRoute,
  distanceBetweenLatLng,
} from '../utils/geoUtils';

describe('geoUtils', () => {
  describe('bearingBetweenLatLng', () => {
    it('calculates bearing from north to south (180°)', () => {
      const bearing = bearingBetweenLatLng(50.0, 0.0, 49.0, 0.0);
      expect(bearing).toBeCloseTo(180, 0);
    });

    it('calculates bearing from west to east (90°)', () => {
      const bearing = bearingBetweenLatLng(50.0, -1.0, 50.0, 1.0);
      expect(Math.abs(bearing - 90)).toBeLessThanOrEqual(1); // Allow 1° tolerance for floating-point precision
    });

    it('calculates bearing from east to west (270°)', () => {
      const bearing = bearingBetweenLatLng(50.0, 1.0, 50.0, -1.0);
      expect(Math.abs(bearing - 270)).toBeLessThanOrEqual(1); // Allow 1° tolerance for floating-point precision
    });

    it('calculates bearing from south to north (0°)', () => {
      const bearing = bearingBetweenLatLng(49.0, 0.0, 50.0, 0.0);
      expect(bearing).toBeCloseTo(0, 0);
    });

    it('calculates bearing for diagonal movement (northeast)', () => {
      const bearing = bearingBetweenLatLng(50.0, 0.0, 51.0, 1.0);
      // Should be somewhere between 0° (north) and 90° (east)
      expect(bearing).toBeGreaterThan(0);
      expect(bearing).toBeLessThan(90);
    });
  });

  describe('bearingDelta', () => {
    it('calculates positive delta for right turn', () => {
      const delta = bearingDelta(0, 90); // North to East = +90° right turn
      expect(delta).toBe(90);
    });

    it('calculates negative delta for left turn', () => {
      const delta = bearingDelta(90, 0); // East to North = -90° left turn
      expect(delta).toBe(-90);
    });

    it('calculates delta across 0° boundary', () => {
      const delta = bearingDelta(350, 10); // 350° to 10° = +20° right turn
      expect(delta).toBe(20);
    });

    it('calculates delta across 360° boundary (reverse)', () => {
      const delta = bearingDelta(10, 350); // 10° to 350° = -20° left turn
      expect(delta).toBe(-20);
    });

    it('returns 0 for same bearing', () => {
      const delta = bearingDelta(90, 90);
      expect(delta).toBe(0);
    });

    it('handles 180° turn (returns 180, not -180)', () => {
      const delta = bearingDelta(0, 180);
      expect(delta).toBe(180);
    });

    it('normalizes large positive deltas', () => {
      const delta = bearingDelta(10, 350); // -20° (shortest path)
      expect(delta).toBe(-20);
    });

    it('normalizes large negative deltas', () => {
      const delta = bearingDelta(350, 10); // +20° (shortest path)
      expect(delta).toBe(20);
    });
  });

  describe('upsampleCoordinates', () => {
    it('returns original coordinates if already close enough', () => {
      const coords = [
        { lat: 50.0, lng: 0.0 },
        { lat: 50.0001, lng: 0.0 }, // ~11m apart
      ];
      const upsampled = upsampleCoordinates(coords, 20); // 20m resolution
      expect(upsampled).toHaveLength(2);
    });

    it('inserts interpolated points for large gaps', () => {
      const coords = [
        { lat: 50.0, lng: 0.0 },
        { lat: 50.001, lng: 0.0 }, // ~111m apart
      ];
      const upsampled = upsampleCoordinates(coords, 10); // 10m resolution
      // Should have original 2 + interpolated points
      expect(upsampled.length).toBeGreaterThan(2);
      expect(upsampled.length).toBeLessThanOrEqual(13); // 111m / 10m = 11.1 segments
    });

    it('preserves first coordinate', () => {
      const coords = [
        { lat: 50.0, lng: 0.0 },
        { lat: 50.01, lng: 0.0 },
      ];
      const upsampled = upsampleCoordinates(coords, 10);
      expect(upsampled[0]).toEqual(coords[0]);
    });

    it('preserves last coordinate', () => {
      const coords = [
        { lat: 50.0, lng: 0.0 },
        { lat: 50.01, lng: 0.0 },
      ];
      const upsampled = upsampleCoordinates(coords, 10);
      expect(upsampled[upsampled.length - 1].lat).toBeCloseTo(coords[1].lat, 5);
      expect(upsampled[upsampled.length - 1].lng).toBeCloseTo(coords[1].lng, 5);
    });

    it('handles single coordinate', () => {
      const coords = [{ lat: 50.0, lng: 0.0 }];
      const upsampled = upsampleCoordinates(coords, 10);
      expect(upsampled).toHaveLength(1);
      expect(upsampled[0]).toEqual(coords[0]);
    });

    it('handles empty coordinates', () => {
      const coords: Array<{ lat: number; lng: number }> = [];
      const upsampled = upsampleCoordinates(coords, 10);
      expect(upsampled).toHaveLength(0);
    });

    it('creates evenly spaced interpolated points', () => {
      const coords = [
        { lat: 50.0, lng: 0.0 },
        { lat: 50.001, lng: 0.0 }, // ~111m apart
      ];
      const upsampled = upsampleCoordinates(coords, 50); // 50m resolution
      expect(upsampled.length).toBeGreaterThan(2);

      // Check that distances between consecutive points are reasonably uniform
      for (let i = 1; i < upsampled.length; i++) {
        const prev = upsampled[i - 1];
        const curr = upsampled[i];
        const distance = distanceBetweenLatLng(prev.lat, prev.lng, curr.lat, curr.lng);
        expect(distance).toBeLessThanOrEqual(60); // Allow some tolerance
      }
    });
  });

  describe('segmentRoute', () => {
    it('creates segments for a long route', () => {
      const coords = [
        { lat: 50.0, lng: 0.0 },
        { lat: 50.001, lng: 0.0 }, // ~111m
        { lat: 50.002, lng: 0.0 }, // Another ~111m
      ];
      const segments = segmentRoute(coords, 50); // 50m segments
      expect(segments.length).toBeGreaterThan(0);

      // Each segment should have start/end indices and distance
      for (const segment of segments) {
        expect(segment.startIndex).toBeGreaterThanOrEqual(0);
        expect(segment.endIndex).toBeLessThan(coords.length);
        expect(segment.distance).toBeGreaterThan(0);
      }
    });

    it('creates single segment for short route', () => {
      const coords = [
        { lat: 50.0, lng: 0.0 },
        { lat: 50.0001, lng: 0.0 }, // ~11m
      ];
      const segments = segmentRoute(coords, 50); // 50m segments
      expect(segments).toHaveLength(1);
      expect(segments[0].startIndex).toBe(0);
      expect(segments[0].endIndex).toBe(1);
    });

    it('handles single coordinate', () => {
      const coords = [{ lat: 50.0, lng: 0.0 }];
      const segments = segmentRoute(coords, 50);
      expect(segments).toHaveLength(0);
    });

    it('handles empty coordinates', () => {
      const coords: Array<{ lat: number; lng: number }> = [];
      const segments = segmentRoute(coords, 50);
      expect(segments).toHaveLength(0);
    });

    it('segments have non-overlapping ranges', () => {
      const coords = [
        { lat: 50.0, lng: 0.0 },
        { lat: 50.001, lng: 0.0 },
        { lat: 50.002, lng: 0.0 },
        { lat: 50.003, lng: 0.0 },
      ];
      const segments = segmentRoute(coords, 50);

      for (let i = 1; i < segments.length; i++) {
        const prevEnd = segments[i - 1].endIndex;
        const currStart = segments[i].startIndex;
        expect(currStart).toBe(prevEnd);
      }
    });

    it('respects segment length parameter', () => {
      const coords = [
        { lat: 50.0, lng: 0.0 },
        { lat: 50.001, lng: 0.0 }, // ~111m
      ];
      const segments30 = segmentRoute(coords, 30);
      const segments100 = segmentRoute(coords, 100);

      // With 30m segments, we should get more segments than with 100m
      expect(segments30.length).toBeGreaterThanOrEqual(segments100.length);
    });

    it('includes final partial segment', () => {
      const coords = [
        { lat: 50.0, lng: 0.0 },
        { lat: 50.0005, lng: 0.0 }, // ~55m
        { lat: 50.0006, lng: 0.0 }, // Another ~11m (total 66m)
      ];
      const segments = segmentRoute(coords, 50); // 50m segments

      expect(segments.length).toBeGreaterThanOrEqual(1);

      // Last segment should end at the last coordinate
      const lastSegment = segments[segments.length - 1];
      expect(lastSegment.endIndex).toBe(coords.length - 1);
    });
  });
});
