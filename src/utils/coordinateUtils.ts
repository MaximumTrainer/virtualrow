/**
 * Coordinate conversion utilities.
 *
 * Parses geographic coordinates from common interchange formats (KML and
 * GeoJSON) into the internal `Coordinate` type (`{ lat, lng }`).
 *
 * Both functions return `null` and silently discard values that are
 * non-finite, NaN, or outside valid WGS-84 bounds.
 */

import type { Coordinate } from '../types/index';

/**
 * Parse a single KML coordinate tuple into a `Coordinate`.
 *
 * KML ordering is `longitude,latitude[,altitude]`. The altitude component is
 * ignored. Returns `null` for malformed input or out-of-range values.
 *
 * @example
 * parseKMLCoordinate('13.4050,52.5200,34')  // → { lat: 52.52, lng: 13.405 }
 * parseKMLCoordinate('-180,90')             // → { lat: 90, lng: -180 }
 * parseKMLCoordinate('181,0')              // → null (lng out of range)
 */
export function parseKMLCoordinate(text: string): Coordinate | null {
  const parts = text.trim().split(',');
  if (parts.length < 2) return null;

  const lng = parseFloat(parts[0].trim());
  const lat = parseFloat(parts[1].trim());

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90) return null;
  if (lng < -180 || lng > 180) return null;

  return { lat, lng };
}

/**
 * Parse a GeoJSON position array into a `Coordinate`.
 *
 * GeoJSON ordering is `[longitude, latitude[, altitude]]`. The altitude
 * component (index 2+) is ignored. Returns `null` for arrays shorter than
 * 2 elements, non-numeric values, or out-of-range coordinates.
 *
 * @example
 * parseGeoJSONCoordinate([13.405, 52.52, 34])  // → { lat: 52.52, lng: 13.405 }
 * parseGeoJSONCoordinate([-73.935, 40.73])      // → { lat: 40.73, lng: -73.935 }
 * parseGeoJSONCoordinate([181, 0])              // → null (lng out of range)
 */
export function parseGeoJSONCoordinate(coords: number[]): Coordinate | null {
  if (!Array.isArray(coords) || coords.length < 2) return null;

  const lng = coords[0];
  const lat = coords[1];

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90) return null;
  if (lng < -180 || lng > 180) return null;

  return { lat, lng };
}

/**
 * Parse all KML coordinate tuples from a `<coordinates>` element's text
 * content. Whitespace-separated tuples of the form `lng,lat[,alt]`. Invalid
 * tuples are silently skipped.
 */
export function parseKMLCoordinateList(text: string): Coordinate[] {
  const tuples = text.trim().split(/\s+/).filter((s) => s.length > 0);
  const coords: Coordinate[] = [];
  for (const tuple of tuples) {
    const coord = parseKMLCoordinate(tuple);
    if (coord) coords.push(coord);
  }
  return coords;
}
