import { describe, it, expect } from 'vitest';
import {
  parseKMLCoordinate,
  parseGeoJSONCoordinate,
  parseKMLCoordinateList,
} from '../utils/coordinateUtils';

describe('coordinateUtils', () => {
  describe('parseKMLCoordinate', () => {
    it('parses a valid lng,lat tuple', () => {
      const coord = parseKMLCoordinate('13.4050,52.5200');
      expect(coord).toEqual({ lat: 52.52, lng: 13.405 });
    });

    it('parses a valid lng,lat,alt tuple (ignores altitude)', () => {
      const coord = parseKMLCoordinate('13.4050,52.5200,34');
      expect(coord).toEqual({ lat: 52.52, lng: 13.405 });
    });

    it('handles negative longitude (west)', () => {
      const coord = parseKMLCoordinate('-73.935,40.73');
      expect(coord).toEqual({ lat: 40.73, lng: -73.935 });
    });

    it('handles negative latitude (south)', () => {
      const coord = parseKMLCoordinate('151.2093,-33.8688');
      expect(coord).toEqual({ lat: -33.8688, lng: 151.2093 });
    });

    it('accepts boundary values (lng=-180, lat=90)', () => {
      expect(parseKMLCoordinate('-180,90')).toEqual({ lat: 90, lng: -180 });
    });

    it('accepts boundary values (lng=180, lat=-90)', () => {
      expect(parseKMLCoordinate('180,-90')).toEqual({ lat: -90, lng: 180 });
    });

    it('returns null for lng out of range (> 180)', () => {
      expect(parseKMLCoordinate('181,0')).toBeNull();
    });

    it('returns null for lng out of range (< -180)', () => {
      expect(parseKMLCoordinate('-181,0')).toBeNull();
    });

    it('returns null for lat out of range (> 90)', () => {
      expect(parseKMLCoordinate('0,91')).toBeNull();
    });

    it('returns null for lat out of range (< -90)', () => {
      expect(parseKMLCoordinate('0,-91')).toBeNull();
    });

    it('returns null for non-numeric values', () => {
      expect(parseKMLCoordinate('abc,def')).toBeNull();
    });

    it('returns null for empty string', () => {
      expect(parseKMLCoordinate('')).toBeNull();
    });

    it('returns null for single component (no comma)', () => {
      expect(parseKMLCoordinate('13.405')).toBeNull();
    });

    it('trims whitespace around values', () => {
      const coord = parseKMLCoordinate(' 13.405 , 52.52 ');
      expect(coord).toEqual({ lat: 52.52, lng: 13.405 });
    });
  });

  describe('parseGeoJSONCoordinate', () => {
    it('parses a [lng, lat] array', () => {
      const coord = parseGeoJSONCoordinate([13.405, 52.52]);
      expect(coord).toEqual({ lat: 52.52, lng: 13.405 });
    });

    it('parses a [lng, lat, alt] array (ignores altitude)', () => {
      const coord = parseGeoJSONCoordinate([13.405, 52.52, 34]);
      expect(coord).toEqual({ lat: 52.52, lng: 13.405 });
    });

    it('handles negative longitude (west)', () => {
      const coord = parseGeoJSONCoordinate([-73.935, 40.73]);
      expect(coord).toEqual({ lat: 40.73, lng: -73.935 });
    });

    it('handles negative latitude (south)', () => {
      const coord = parseGeoJSONCoordinate([151.2093, -33.8688]);
      expect(coord).toEqual({ lat: -33.8688, lng: 151.2093 });
    });

    it('accepts boundary values', () => {
      expect(parseGeoJSONCoordinate([-180, -90])).toEqual({ lat: -90, lng: -180 });
      expect(parseGeoJSONCoordinate([180, 90])).toEqual({ lat: 90, lng: 180 });
    });

    it('returns null for lng > 180', () => {
      expect(parseGeoJSONCoordinate([181, 0])).toBeNull();
    });

    it('returns null for lng < -180', () => {
      expect(parseGeoJSONCoordinate([-181, 0])).toBeNull();
    });

    it('returns null for lat > 90', () => {
      expect(parseGeoJSONCoordinate([0, 91])).toBeNull();
    });

    it('returns null for lat < -90', () => {
      expect(parseGeoJSONCoordinate([0, -91])).toBeNull();
    });

    it('returns null for array shorter than 2 elements', () => {
      expect(parseGeoJSONCoordinate([13.405])).toBeNull();
    });

    it('returns null for empty array', () => {
      expect(parseGeoJSONCoordinate([])).toBeNull();
    });

    it('returns null for NaN values', () => {
      expect(parseGeoJSONCoordinate([NaN, 52.52])).toBeNull();
    });

    it('returns null for Infinity values', () => {
      expect(parseGeoJSONCoordinate([Infinity, 0])).toBeNull();
    });
  });

  describe('parseKMLCoordinateList', () => {
    it('parses multiple whitespace-separated tuples', () => {
      const coords = parseKMLCoordinateList('13.405,52.52 14.0,53.0 15.0,54.0');
      expect(coords).toHaveLength(3);
      expect(coords[0]).toEqual({ lat: 52.52, lng: 13.405 });
      expect(coords[1]).toEqual({ lat: 53.0, lng: 14.0 });
      expect(coords[2]).toEqual({ lat: 54.0, lng: 15.0 });
    });

    it('skips invalid tuples and keeps valid ones', () => {
      const coords = parseKMLCoordinateList('13.405,52.52 abc,def 15.0,54.0');
      expect(coords).toHaveLength(2);
      expect(coords[0]).toEqual({ lat: 52.52, lng: 13.405 });
      expect(coords[1]).toEqual({ lat: 54.0, lng: 15.0 });
    });

    it('handles newline-separated tuples (KML multiline format)', () => {
      const coords = parseKMLCoordinateList('13.405,52.52,34\n14.0,53.0,0\n');
      expect(coords).toHaveLength(2);
    });

    it('returns empty array for empty string', () => {
      expect(parseKMLCoordinateList('')).toHaveLength(0);
    });

    it('skips out-of-range tuples', () => {
      const coords = parseKMLCoordinateList('181,0 13.405,52.52');
      expect(coords).toHaveLength(1);
      expect(coords[0]).toEqual({ lat: 52.52, lng: 13.405 });
    });
  });
});
