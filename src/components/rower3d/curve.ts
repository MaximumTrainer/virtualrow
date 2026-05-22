/**
 * Pure curve / GPS-to-scene math for the Rower3D component.
 *
 * Extracted from `Rower3D.tsx` so the geometric helpers can be unit-tested
 * independently from the React Three Fiber render tree. None of these
 * functions have observable side effects; everything is deterministic given
 * the same inputs.
 */
import * as THREE from 'three';
import type { Coordinate } from '../../types/index';
import { latLngToMeters } from '../../utils/geoUtils';

/**
 * Convert a polyline of GPS coordinates into 3D scene points.
 *
 * The first coordinate is used as the local origin (0, 0). X maps to
 * east/west and Z to north/south, but Z is negated so that the boat
 * naturally moves in the -Z direction (the camera-forward axis used
 * throughout the scene).
 */
export const gpsToScenePoints = (
  coordinates: Coordinate[],
  sceneScale: number = 0.1,
): THREE.Vector3[] => {
  if (coordinates.length < 2) return [];

  const origin = coordinates[0];
  const points: THREE.Vector3[] = [];

  for (const coord of coordinates) {
    const meters = latLngToMeters(coord.lat, coord.lng, origin.lat, origin.lng);
    points.push(
      new THREE.Vector3(
        meters.x * sceneScale,
        0,
        -meters.y * sceneScale,
      ),
    );
  }

  return points;
};

/**
 * Build a smooth Catmull-Rom spline from a GPS polyline.
 *
 * Returns `null` if fewer than two coordinates are provided.
 */
export const createRouteCurve = (
  coordinates: Coordinate[],
  sceneScale: number = 0.1,
): THREE.CatmullRomCurve3 | null => {
  const points = gpsToScenePoints(coordinates, sceneScale);
  if (points.length < 2) return null;

  return new THREE.CatmullRomCurve3(points, false, 'catmullrom', 0.5);
};

/** Position and orientation of the boat at a given point along the curve. */
export interface RoutePosition {
  position: THREE.Vector3;
  tangent: THREE.Vector3;
  /** Rotation angle in radians around the Y axis (boat heading). */
  angle: number;
}

/**
 * Get the boat position, tangent, and Y-axis heading at a given normalised
 * progress (0..1) along the curve.
 *
 * When `outPosition` / `outTangent` are supplied, the curve sample is written
 * into them in-place — this avoids per-frame `THREE.Vector3` allocations on
 * the render hot path. The returned `RoutePosition` re-uses the same
 * references.
 */
export const getRoutePositionAtProgress = (
  curve: THREE.CatmullRomCurve3 | null,
  progress: number,
  outPosition?: THREE.Vector3,
  outTangent?: THREE.Vector3,
): RoutePosition => {
  const position = outPosition ?? new THREE.Vector3();
  const tangent = outTangent ?? new THREE.Vector3();

  if (!curve) {
    // Fallback to straight line in -Z direction.
    position.set(0, 0, -progress * 100);
    tangent.set(0, 0, -1);
    return { position, tangent, angle: 0 };
  }

  const clampedProgress = Math.max(0, Math.min(1, progress));
  curve.getPointAt(clampedProgress, position);
  curve.getTangentAt(clampedProgress, tangent).normalize();

  // The boat's bow (front) is at local -Z, so we rotate to align local -Z
  // with the tangent. `atan2(x, z)` gives the Y-axis rotation that achieves
  // that alignment.
  const angle = Math.atan2(tangent.x, tangent.z);

  return { position, tangent, angle };
};

/**
 * Sample the curve uniformly in parameter space and return cumulative arc
 * lengths at each sample point. Used by {@link distanceToProgress} for an
 * accurate distance-to-parameter mapping.
 */
export const getCurveDistances = (
  curve: THREE.CatmullRomCurve3,
  samples: number = 200,
): number[] => {
  const distances: number[] = [0];
  let totalDist = 0;
  const p0 = new THREE.Vector3();
  const p1 = new THREE.Vector3();

  curve.getPointAt(0, p0);
  for (let i = 1; i <= samples; i++) {
    const t1 = i / samples;
    curve.getPointAt(t1, p1);
    totalDist += p0.distanceTo(p1);
    distances.push(totalDist);
    p0.copy(p1);
  }

  return distances;
};

/**
 * Map a real-world distance travelled (in metres along the GPS route) to a
 * normalised progress value (0..1) on the curve.
 *
 * @param distanceMeters       Real-world distance travelled in metres.
 * @param totalDistanceMeters  Total real-world route distance in metres.
 * @param curveDistances       Output of {@link getCurveDistances}.
 * @param curveLength          The final entry of `curveDistances` (scene units).
 */
export const distanceToProgress = (
  distanceMeters: number,
  totalDistanceMeters: number,
  curveDistances: number[],
  curveLength: number,
): number => {
  if (totalDistanceMeters <= 0 || curveLength <= 0) return 0;

  // Map real-world distance to curve distance.
  const curveDistance = (distanceMeters / totalDistanceMeters) * curveLength;

  // Binary search to find the sample bracket containing `curveDistance`.
  let low = 0;
  let high = curveDistances.length - 1;

  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (curveDistances[mid] < curveDistance) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }

  // Linearly interpolate within the bracket for sub-sample precision.
  const idx = Math.max(0, low - 1);
  const nextIdx = Math.min(curveDistances.length - 1, low);
  const segmentStart = curveDistances[idx];
  const segmentEnd = curveDistances[nextIdx];
  const segmentLength = segmentEnd - segmentStart;

  let t = idx / (curveDistances.length - 1);
  if (segmentLength > 0) {
    const within = (curveDistance - segmentStart) / segmentLength;
    t += within / (curveDistances.length - 1);
  }

  return Math.max(0, Math.min(1, t));
};
