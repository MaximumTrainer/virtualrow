/**
 * Polyline geometry helpers for the route import layer.
 *
 * These operate on `Coordinate[]` polylines in metres, using a local
 * equirectangular frame anchored on each segment. Over the segment lengths a
 * course polyline uses (metres to a few kilometres) that is accurate to well
 * under a metre, and it keeps every distance in this module consistent with
 * `distanceBetweenMeters` — the single geodesic the whole app now shares.
 *
 * Nothing here touches the 3D engine: it all runs before `createRoute()`.
 */

import type { Coordinate } from '../types/index';
import { EARTH_RADIUS_M, distanceBetweenMeters } from './coordinateUtils';

const DEG_TO_RAD = Math.PI / 180;
const METERS_PER_DEGREE_LAT = (EARTH_RADIUS_M * Math.PI) / 180;

/** Where a point lands when projected onto a polyline. */
export interface PolylineProjection {
  /** Perpendicular distance from the point to the polyline, in metres. */
  offsetMeters: number;
  /** Index of the segment the projection fell on. */
  segmentIndex: number;
  /** Position within that segment, 0 at its start and 1 at its end. */
  segmentFraction: number;
  /** Distance from the polyline's first vertex to the projection, in metres. */
  alongMeters: number;
  /** The projected point itself. */
  point: Coordinate;
}

/** Project a coordinate into a local metric frame centred on `origin`. */
function toLocalMeters(point: Coordinate, origin: Coordinate): { x: number; y: number } {
  return {
    x: (point.lng - origin.lng) * METERS_PER_DEGREE_LAT * Math.cos(origin.lat * DEG_TO_RAD),
    y: (point.lat - origin.lat) * METERS_PER_DEGREE_LAT,
  };
}

/**
 * Running distance to each vertex: `cumulative[i]` is the length of the
 * polyline up to vertex `i`, so `cumulative[last]` is its total length.
 */
export function cumulativeLengths(line: Coordinate[]): number[] {
  const cumulative = new Array<number>(line.length);
  cumulative[0] = 0;
  for (let i = 1; i < line.length; i++) {
    cumulative[i] = cumulative[i - 1] + distanceBetweenMeters(line[i - 1], line[i]);
  }
  return cumulative;
}

/** Linear interpolation between two coordinates. */
function lerp(a: Coordinate, b: Coordinate, t: number): Coordinate {
  return { lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t };
}

/**
 * Nearest point on `line` to `point`, as a point-to-segment projection.
 *
 * A single-vertex line projects onto that vertex. An empty line is a
 * programming error and throws.
 */
export function projectPointOntoPolyline(point: Coordinate, line: Coordinate[]): PolylineProjection {
  if (line.length === 0) throw new Error('Cannot project onto an empty polyline.');
  if (line.length === 1) {
    return {
      offsetMeters: distanceBetweenMeters(point, line[0]),
      segmentIndex: 0,
      segmentFraction: 0,
      alongMeters: 0,
      point: line[0],
    };
  }

  let best: PolylineProjection | null = null;
  let travelled = 0;

  for (let i = 0; i < line.length - 1; i++) {
    const origin = line[i];
    const end = toLocalMeters(line[i + 1], origin);
    const target = toLocalMeters(point, origin);
    const segmentLength = distanceBetweenMeters(origin, line[i + 1]);
    const lengthSquared = end.x * end.x + end.y * end.y;
    const raw = lengthSquared === 0 ? 0 : (target.x * end.x + target.y * end.y) / lengthSquared;
    const fraction = Math.min(1, Math.max(0, raw));
    const offsetMeters = Math.hypot(target.x - fraction * end.x, target.y - fraction * end.y);

    if (!best || offsetMeters < best.offsetMeters) {
      best = {
        offsetMeters,
        segmentIndex: i,
        segmentFraction: fraction,
        alongMeters: travelled + fraction * segmentLength,
        point: lerp(origin, line[i + 1], fraction),
      };
    }
    travelled += segmentLength;
  }

  return best as PolylineProjection;
}

/** The point `alongMeters` into `line`, clamped to its two ends. */
export function interpolateAlong(
  line: Coordinate[],
  alongMeters: number,
  cumulative: number[] = cumulativeLengths(line),
): Coordinate {
  const total = cumulative[cumulative.length - 1];
  if (alongMeters <= 0) return line[0];
  if (alongMeters >= total) return line[line.length - 1];

  let i = 1;
  while (i < cumulative.length - 1 && cumulative[i] < alongMeters) i++;
  const segmentLength = cumulative[i] - cumulative[i - 1];
  const fraction = segmentLength === 0 ? 0 : (alongMeters - cumulative[i - 1]) / segmentLength;
  return lerp(line[i - 1], line[i], fraction);
}

/**
 * The portion of `line` between two distances along it, with exact
 * interpolated endpoints. Returns at least two points.
 */
export function slicePolyline(line: Coordinate[], fromMeters: number, toMeters: number): Coordinate[] {
  const cumulative = cumulativeLengths(line);
  const total = cumulative[cumulative.length - 1];
  const from = Math.min(Math.max(0, fromMeters), total);
  const to = Math.min(Math.max(from, toMeters), total);

  const sliced: Coordinate[] = [interpolateAlong(line, from, cumulative)];
  for (let i = 0; i < line.length; i++) {
    if (cumulative[i] > from && cumulative[i] < to) sliced.push(line[i]);
  }
  sliced.push(interpolateAlong(line, to, cumulative));

  // Interpolated endpoints can coincide with the vertex they sit on.
  return sliced.filter((point, index) => index === 0 || distanceBetweenMeters(sliced[index - 1], point) > 1e-6);
}

/** The same polyline walked in the opposite direction. */
export function reversePolyline(line: Coordinate[]): Coordinate[] {
  return [...line].reverse();
}

/**
 * Re-cut a closed loop so it begins (and ends) `fromMeters` along it.
 *
 * The tail from `fromMeters` onwards is followed by the head, so the result
 * covers the whole loop exactly once and returns to where it started. A loop
 * whose first and last vertices do not coincide keeps that gap, which closes
 * the ring rather than leaving the boat short of the finish.
 */
export function rotateLoopToStart(line: Coordinate[], fromMeters: number): Coordinate[] {
  const cumulative = cumulativeLengths(line);
  const total = cumulative[cumulative.length - 1];
  const tail = slicePolyline(line, fromMeters, total);
  const head = slicePolyline(line, 0, fromMeters);
  const joined = distanceBetweenMeters(tail[tail.length - 1], head[0]) < 1 ? head.slice(1) : head;
  return [...tail, ...joined];
}

/** Largest distance between any two vertices, in metres. */
export function maxVertexExtentMeters(vertices: Coordinate[]): number {
  let extent = 0;
  for (let i = 0; i < vertices.length; i++) {
    for (let j = i + 1; j < vertices.length; j++) {
      const separation = distanceBetweenMeters(vertices[i], vertices[j]);
      if (separation > extent) extent = separation;
    }
  }
  return extent;
}
