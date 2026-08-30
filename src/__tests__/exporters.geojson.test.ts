import { describe, it, expect } from 'vitest';
import {
  buildAttachedTrackGeoJSON,
  slugify,
} from '../utils/exporters';
import { parseGeoJsonTrack } from '../utils/trackParsers';
import type { AttachedTrack } from '../services/trackAttachmentStore';

function makeTrack(overrides: Partial<AttachedTrack> = {}): AttachedTrack {
  return {
    courseId: '42',
    fileName: 'cam-head.gpx',
    attachedAt: Date.now(),
    coordinates: [
      { lat: 52.202, lng: 0.117 },
      { lat: 52.205, lng: 0.121 },
      { lat: 52.208, lng: 0.125 },
    ],
    ...overrides,
  };
}

const FIXED_NOW = new Date('2026-06-15T12:00:00Z');

describe('buildAttachedTrackGeoJSON', () => {
  it('produces a valid GeoJSON Feature with LineString geometry', () => {
    const result = buildAttachedTrackGeoJSON(makeTrack(), 'Head of the Cam', FIXED_NOW);

    expect(result.type).toBe('Feature');
    expect(result.geometry.type).toBe('LineString');
    expect(result.geometry.coordinates).toHaveLength(3);
  });

  it('emits coordinates in [lng, lat] order per RFC 7946', () => {
    const track = makeTrack({
      coordinates: [{ lat: 51.5, lng: -0.1 }],
    });
    const result = buildAttachedTrackGeoJSON(track, 'Thames', FIXED_NOW);

    expect(result.geometry.coordinates[0]).toEqual([-0.1, 51.5]);
  });

  it('sets provenance properties with courseId, courseName, source, and exportedAt', () => {
    const result = buildAttachedTrackGeoJSON(makeTrack(), 'Head of the Cam', FIXED_NOW);

    expect(result.properties).toEqual({
      courseId: '42',
      courseName: 'Head of the Cam',
      source: 'virtualrow-attached-track',
      exportedAt: '2026-06-15T12:00:00.000Z',
    });
  });

  it('round-trips through parseGeoJsonTrack', () => {
    const track = makeTrack();
    const geojson = buildAttachedTrackGeoJSON(track, 'Cam', FIXED_NOW);
    const json = JSON.stringify(geojson);

    const { coordinates: parsed } = parseGeoJsonTrack(json);

    expect(parsed).toHaveLength(track.coordinates.length);
    parsed.forEach((pt, i) => {
      expect(pt.lat).toBeCloseTo(track.coordinates[i].lat, 6);
      expect(pt.lng).toBeCloseTo(track.coordinates[i].lng, 6);
    });
  });

  it('handles a two-point track (minimum viable)', () => {
    const track = makeTrack({
      coordinates: [
        { lat: 0, lng: 0 },
        { lat: 1, lng: 1 },
      ],
    });
    const result = buildAttachedTrackGeoJSON(track, 'Minimal', FIXED_NOW);

    expect(result.geometry.coordinates).toHaveLength(2);
    const { coordinates: roundTripped } = parseGeoJsonTrack(JSON.stringify(result));
    expect(roundTripped).toHaveLength(2);
  });

  it('preserves coordinate precision', () => {
    const track = makeTrack({
      coordinates: [
        { lat: 52.20198765, lng: 0.11712345 },
        { lat: 52.20512345, lng: 0.12198765 },
      ],
    });
    const result = buildAttachedTrackGeoJSON(track, 'Precise', FIXED_NOW);

    expect(result.geometry.coordinates[0][0]).toBe(0.11712345);
    expect(result.geometry.coordinates[0][1]).toBe(52.20198765);
  });

  it('uses the provided timestamp, not wall clock', () => {
    const t1 = new Date('2024-01-01T00:00:00Z');
    const t2 = new Date('2025-12-31T23:59:59Z');

    const r1 = buildAttachedTrackGeoJSON(makeTrack(), 'A', t1);
    const r2 = buildAttachedTrackGeoJSON(makeTrack(), 'A', t2);

    expect(r1.properties.exportedAt).toBe('2024-01-01T00:00:00.000Z');
    expect(r2.properties.exportedAt).toBe('2025-12-31T23:59:59.000Z');
  });
});

describe('slugify', () => {
  it('lowercases and replaces non-alphanumeric runs with hyphens', () => {
    expect(slugify('Head of the Cam')).toBe('head-of-the-cam');
  });

  it('strips leading and trailing hyphens', () => {
    expect(slugify('--test--')).toBe('test');
  });

  it('handles unicode and special characters', () => {
    expect(slugify('Zürichsee (CH)')).toBe('z-richsee-ch');
  });

  it('truncates to 60 characters', () => {
    const long = 'a'.repeat(100);
    expect(slugify(long).length).toBeLessThanOrEqual(60);
  });

  it('falls back to "track" for empty input', () => {
    expect(slugify('')).toBe('track');
    expect(slugify('!!!')).toBe('track');
  });
});
