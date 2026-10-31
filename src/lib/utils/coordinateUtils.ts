/**
 * Coordinate conversion utilities.
 *
 * Parses geographic coordinates from common interchange formats (KML and
 * GeoJSON) into the internal `Coordinate` type (`{ lat, lng }`).
 *
 * All parsing functions return `null` (or skip the entry, for list parsers)
 * and silently discard values that are non-numeric, non-finite, NaN, or
 * outside valid WGS-84 bounds.
 */

import type { Coordinate } from '../types/index';

/** Strict numeric regex: optional sign, integer or decimal, optional exponent. */
const NUMERIC_RE = /^[+-]?(?:\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

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

  const lngStr = parts[0].trim();
  const latStr = parts[1].trim();
  if (!NUMERIC_RE.test(lngStr) || !NUMERIC_RE.test(latStr)) return null;

  const lng = parseFloat(lngStr);
  const lat = parseFloat(latStr);

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
/**
 * Share of a track's points that may be unusable before an import is refused.
 *
 * Real KML exports carry the occasional junk row, and failing a 900-point
 * track over one bad tuple is hostile. A file where a tenth of the points are
 * unreadable is a different thing — a wrong projection, a truncated download,
 * or not the file the user meant — and importing a tenth of a river as if it
 * were the whole one is worse than refusing it (#191, KV-2).
 */
export const MAX_DROPPED_POINT_RATIO = 0.1;

export interface ParsedCoordinateList {
  /** The points that parsed and fell inside WGS-84 bounds. */
  coordinates: Coordinate[];
  /** Tuples that were present but unusable: malformed, or out of range. */
  dropped: number;
  /** Tuples seen in total. */
  total: number;
}

/**
 * True when enough of a track was unreadable that it should not be imported.
 *
 * One bad tuple is always forgiven, whatever the track's length: a ratio alone
 * would fail a four-point outline over a single junk row while waving through
 * ninety bad points in a nine-hundred-point river.
 */
export function exceedsDropAllowance({ dropped, total }: ParsedCoordinateList): boolean {
  if (total === 0) return false;
  const allowance = Math.max(1, Math.floor(total * MAX_DROPPED_POINT_RATIO));
  return dropped > allowance;
}

export function parseKMLCoordinateList(text: string): ParsedCoordinateList {
  const tuples = text.trim().split(/\s+/).filter((s) => s.length > 0);
  const coordinates: Coordinate[] = [];
  let dropped = 0;
  for (const tuple of tuples) {
    const coord = parseKMLCoordinate(tuple);
    if (coord) {
      coordinates.push(coord);
    } else {
      dropped++;
    }
  }
  return { coordinates, dropped, total: tuples.length };
}

/**
 * Mean Earth radius (IUGG), in metres.
 *
 * The single radius constant in the app: every distance the import layer and
 * the 3D engine compute goes through `distanceBetweenMeters`, so a route's
 * reported length and the length the boat rows can never drift apart.
 */
export const EARTH_RADIUS_M = 6371008.8;

/**
 * Great-circle distance between two coordinates, in metres.
 *
 * Uses the haversine formula against a spherical Earth. Accurate to well under
 * a metre at the segment lengths we deal with, which is far below the
 * resolution that matters for route geometry.
 */
export function distanceBetweenMeters(a: Coordinate, b: Coordinate): number {
  const R = EARTH_RADIUS_M;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Total length of a coordinate sequence, in metres. */
export function polylineLengthMeters(coordinates: Coordinate[]): number {
  let total = 0;
  for (let i = 0; i < coordinates.length - 1; i++) {
    total += distanceBetweenMeters(coordinates[i], coordinates[i + 1]);
  }
  return total;
}

/**
 * Densify a coordinate sequence so no two consecutive points are further
 * apart than `maxGapMeters`.
 *
 * Points are interpolated **along the existing segments only** — this adds
 * resolution for the 3D camera and progress tracking, it never invents bends
 * the source data did not contain. A two-point course stays a straight line;
 * it just becomes a straight line made of many points.
 *
 * Every input point is preserved, in order. Sequences shorter than two points
 * are returned unchanged.
 *
 * @param maxGapMeters Maximum spacing between consecutive points. Must be > 0.
 */
export function resampleCoordinates(
  coordinates: Coordinate[],
  maxGapMeters: number,
): Coordinate[] {
  if (coordinates.length < 2 || !Number.isFinite(maxGapMeters) || maxGapMeters <= 0) {
    return coordinates;
  }

  const result: Coordinate[] = [coordinates[0]];

  for (let i = 0; i < coordinates.length - 1; i++) {
    const start = coordinates[i];
    const end = coordinates[i + 1];
    const gap = distanceBetweenMeters(start, end);

    // segments = 1 leaves the pair untouched; > 1 inserts evenly spaced points.
    const segments = Math.ceil(gap / maxGapMeters);
    for (let step = 1; step < segments; step++) {
      const t = step / segments;
      result.push({
        lat: start.lat + (end.lat - start.lat) * t,
        lng: start.lng + (end.lng - start.lng) * t,
      });
    }
    result.push(end);
  }

  return result;
}

const DEG_TO_RAD = Math.PI / 180;

/**
 * Initial great-circle bearing from `a` to `b`, in radians clockwise from north.
 *
 * The single bearing implementation: `calculateBearing` in geoUtils is the
 * degrees-valued wrapper around this one.
 */
export function bearingRadians(a: Coordinate, b: Coordinate): number {
  const phi1 = a.lat * DEG_TO_RAD;
  const phi2 = b.lat * DEG_TO_RAD;
  const deltaLambda = (b.lng - a.lng) * DEG_TO_RAD;

  const y = Math.sin(deltaLambda) * Math.cos(phi2);
  const x =
    Math.cos(phi1) * Math.sin(phi2) -
    Math.sin(phi1) * Math.cos(phi2) * Math.cos(deltaLambda);

  return Math.atan2(y, x);
}

/**
 * Deviation a simplified route may show from the one that was imported.
 *
 * Three metres is under the scatter of consumer GPS and well below the 10 m
 * grid the scene curve is upsampled onto, so the simplifier can only remove
 * points the renderer was about to interpolate back anyway.
 *
 * This epsilon bounds the distance to the straight *chord* that replaces a
 * dropped point, not to the spline the scene actually draws through those
 * chords. The two only stay close because `upsampleRouteCoordinates` weights
 * its Hermite tangents by point spacing; without that, simplification's uneven
 * spacing threw the drawn water 6.8 m off a hairpin at this same epsilon.
 * `renderedRouteFidelity.test.ts` measures what is drawn, and is the test to
 * trust if this number is ever raised (#224).
 */
export const DEFAULT_SIMPLIFY_EPSILON_METERS = 3;

/**
 * Drop the points that contribute nothing to a route's shape.
 *
 * Ramer-Douglas-Peucker: keep the two endpoints, keep whichever point strays
 * furthest from the chord between them if that stray exceeds `epsilonMeters`,
 * and repeat on the two halves. Every retained point is an original point —
 * nothing is invented or moved — and no dropped point lay further than the
 * epsilon from the polyline that replaced it.
 *
 * Long straight stretches, which a 50 m import resample fills with collinear
 * filler, collapse to their endpoints; bends survive intact.
 *
 * Worked through an explicit stack rather than by recursion: a 20,000-point
 * track can nest deeply enough to overflow the call stack.
 */
export function simplifyCoordinates(
  coordinates: Coordinate[],
  epsilonMeters: number = DEFAULT_SIMPLIFY_EPSILON_METERS,
): Coordinate[] {
  if (coordinates.length < 3 || !(epsilonMeters > 0)) return coordinates;

  const plane = projectToLocalMeters(coordinates);
  const lastIndex = coordinates.length - 1;
  const epsilonSquared = epsilonMeters * epsilonMeters;
  const keep = new Uint8Array(coordinates.length);
  keep[0] = 1;
  keep[lastIndex] = 1;

  const pending: number[] = [0, lastIndex];
  while (pending.length > 0) {
    const last = pending.pop()!;
    const first = pending.pop()!;
    let furthestIndex = -1;
    let furthest = epsilonSquared;

    for (let i = first + 1; i < last; i++) {
      const deviation = squaredDistanceToSegment(plane, i, first, last);
      if (deviation > furthest) {
        furthest = deviation;
        furthestIndex = i;
      }
    }

    if (furthestIndex !== -1) {
      keep[furthestIndex] = 1;
      pending.push(first, furthestIndex, furthestIndex, last);
    }
  }

  return coordinates.filter((_, index) => keep[index] === 1);
}

/**
 * Project a track onto a local east/north plane in metres, as `[x, y, ...]`.
 *
 * The scale comes from the same mean radius `distanceBetweenMeters` uses, so a
 * deviation measured on this plane is a deviation in route metres. Across one
 * course it differs from the great-circle measure by well under a millimetre —
 * far below any epsilon worth simplifying at — and it buys an inner loop with
 * no trigonometry in it. Measured on a 10,000-point track, that is the
 * difference between 54 ms and 3 ms, which is the whole point of simplifying
 * before the geometry build rather than after it (#224).
 */
function projectToLocalMeters(coordinates: Coordinate[]): Float64Array {
  const metersPerDegree = EARTH_RADIUS_M * DEG_TO_RAD;
  const origin = coordinates[0];
  const eastScale = metersPerDegree * Math.cos(origin.lat * DEG_TO_RAD);

  const plane = new Float64Array(coordinates.length * 2);
  coordinates.forEach(({ lat, lng }, index) => {
    plane[index * 2] = (lng - origin.lng) * eastScale;
    plane[index * 2 + 1] = (lat - origin.lat) * metersPerDegree;
  });
  return plane;
}

/** Squared metres from point `index` to the segment `first`→`last` on the plane. */
function squaredDistanceToSegment(
  plane: Float64Array,
  index: number,
  first: number,
  last: number,
): number {
  const px = plane[index * 2];
  const py = plane[index * 2 + 1];
  const ax = plane[first * 2];
  const ay = plane[first * 2 + 1];
  const dx = plane[last * 2] - ax;
  const dy = plane[last * 2 + 1] - ay;

  const segmentSquared = dx * dx + dy * dy;
  // A degenerate segment — the two ends of a closed loop — leaves the start as
  // the only thing there is to measure against.
  const along =
    segmentSquared > 0
      ? Math.min(1, Math.max(0, ((px - ax) * dx + (py - ay) * dy) / segmentSquared))
      : 0;

  const offX = ax + along * dx - px;
  const offY = ay + along * dy - py;
  return offX * offX + offY * offY;
}
