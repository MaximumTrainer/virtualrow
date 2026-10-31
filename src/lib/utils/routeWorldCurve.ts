/**
 * Route → world-space curve points, framework-free (#570 AC2).
 *
 * The WebGPU engine places the boat and ghost along `route.curvePoints`
 * (`src/lib/renderer/engine/attach.ts` → `RouteCurve`, a three-free port of the
 * old scene's `createRouteCurve`). To feed it a real route, the shell has to
 * turn the selected route's GPS polyline into the same world-space points the
 * engine's curve sampler expects.
 *
 * This is a three-free port of `gpsToScenePoints` + `upsampleRouteCoordinates`
 * from `src/components/rower3d/curve.ts`, kept here (not imported from there)
 * so no `three` leaks into `src/lib` (AC3/AC7). It keeps that file's contract
 * exactly: simplify first, then upsample onto an even ~10 m grid so the engine
 * (which samples the curve uniformly in parameter space) tracks arc length;
 * X maps to east, Z to the negated north so the boat runs in −Z; one scene
 * unit is one metre (`SCENE_SCALE`, #321), so the points are world metres.
 */
import type { Coordinate } from '../types/index';
import { SCENE_SCALE } from './worldScale';
import { latLngToMeters, distanceBetweenLatLng } from './geoUtils';
import { simplifyCoordinates, DEFAULT_SIMPLIFY_EPSILON_METERS } from './coordinateUtils';

/** Metres between interpolated points — matches the old scene's resolution. */
export const DEFAULT_ROUTE_POINT_RESOLUTION_METERS = 10;

const cubicHermite = (p0: number, p1: number, m0: number, m1: number, t: number): number => {
  const t2 = t * t;
  const t3 = t2 * t;
  return (
    (2 * t3 - 3 * t2 + 1) * p0 +
    (t3 - 2 * t2 + t) * m0 +
    (-2 * t3 + 3 * t2) * p1 +
    (t3 - t2) * m1
  );
};

/**
 * Densify a route onto a `minResolutionMeters` grid along a cubic Hermite,
 * with tangents weighted by the spacing either side of each point (#224). A
 * three-free copy of `upsampleRouteCoordinates` from the retiring scene.
 */
export const upsampleRouteCoordinates = (
  coordinates: Coordinate[],
  minResolutionMeters: number = DEFAULT_ROUTE_POINT_RESOLUTION_METERS,
): Coordinate[] => {
  if (coordinates.length < 2 || minResolutionMeters <= 0) return coordinates;

  const spans = coordinates.slice(0, -1).map((coord, index) =>
    distanceBetweenLatLng(coord.lat, coord.lng, coordinates[index + 1].lat, coordinates[index + 1].lng),
  );

  const tangentAt = (index: number, spanMeters: number): Coordinate => {
    const previous = coordinates[Math.max(0, index - 1)];
    const next = coordinates[Math.min(coordinates.length - 1, index + 1)];

    if (index === 0 || index === coordinates.length - 1) {
      const from = index === 0 ? coordinates[0] : previous;
      const to = index === 0 ? next : coordinates[index];
      return { lat: to.lat - from.lat, lng: to.lng - from.lng };
    }

    const before = spans[index - 1];
    const after = spans[index];
    const neighbourhood = before + after;
    const weight = neighbourhood > 0 ? spanMeters / neighbourhood : 0.5;

    return { lat: (next.lat - previous.lat) * weight, lng: (next.lng - previous.lng) * weight };
  };

  const upsampled: Coordinate[] = [];
  for (let index = 0; index < coordinates.length - 1; index++) {
    const start = coordinates[index];
    const end = coordinates[index + 1];
    upsampled.push(start);

    const segmentDistance = spans[index];
    const subdivisions = Math.ceil(segmentDistance / minResolutionMeters);
    if (subdivisions <= 1) continue;

    const startTangent = tangentAt(index, segmentDistance);
    const endTangent = tangentAt(index + 1, segmentDistance);
    for (let step = 1; step < subdivisions; step++) {
      const t = step / subdivisions;
      upsampled.push({
        lat: cubicHermite(start.lat, end.lat, startTangent.lat, endTangent.lat, t),
        lng: cubicHermite(start.lng, end.lng, startTangent.lng, endTangent.lng, t),
      });
    }
  }
  upsampled.push(coordinates[coordinates.length - 1]);
  return upsampled;
};

/**
 * Convert a GPS polyline into world-space curve points `[x, y, z]` for the
 * engine. The first coordinate is the local origin; X is east, Z is the
 * negated north (the boat runs in −Z), Y is 0. Returns `[]` for fewer than
 * two coordinates — the engine then falls back to its own straight line.
 */
export const routeCurvePoints = (
  coordinates: Coordinate[],
  sceneScale: number = SCENE_SCALE,
  minResolutionMeters: number = DEFAULT_ROUTE_POINT_RESOLUTION_METERS,
  simplifyEpsilonMeters: number = DEFAULT_SIMPLIFY_EPSILON_METERS,
): [number, number, number][] => {
  if (!coordinates || coordinates.length < 2) return [];

  const shape = simplifyCoordinates(coordinates, simplifyEpsilonMeters);
  const dense = upsampleRouteCoordinates(shape, minResolutionMeters);
  if (dense.length < 2) return [];

  const origin = dense[0];
  return dense.map((coord) => {
    const meters = latLngToMeters(coord.lat, coord.lng, origin.lat, origin.lng);
    return [meters.x * sceneScale, 0, -meters.y * sceneScale] as [number, number, number];
  });
};
