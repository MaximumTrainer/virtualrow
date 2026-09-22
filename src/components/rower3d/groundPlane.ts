import * as THREE from 'three';

/**
 * Where to put the ground, and how much of it to make (#334).
 *
 * Pure, and separate from the component, because the question it answers is
 * arithmetic: does this plane cover everywhere the rower can get to, plus
 * everywhere they can see from there. That is checkable without a canvas, and
 * the failure it guards against - a route running off the edge of the world -
 * is invisible until someone rows to the end of a long one.
 */

/** Metres of ground beyond the furthest point of the route. */
export const GROUND_PLANE_MARGIN_METRES = 1000;

/** The smallest ground worth building, for a route with no curve yet. */
export const GROUND_PLANE_MINIMUM_METRES = 2000;

export interface GroundPlanePlan {
  /** Where the plane's centre sits, as [x, z]. */
  centre: [number, number];
  /** The length of each side, in metres. */
  size: number;
}

/**
 * Cover the whole route and a margin past it, centred on the route's own
 * extent rather than on the origin - a route is laid out from its first
 * coordinate, so it can sit entirely to one side of it.
 */
export const groundPlaneFor = (curve: THREE.CatmullRomCurve3 | null): GroundPlanePlan => {
  if (!curve) {
    return { centre: [0, 0], size: GROUND_PLANE_MINIMUM_METRES };
  }

  const points = curve.getPoints(64);
  const xs = points.map((p) => p.x);
  const zs = points.map((p) => p.z);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minZ = Math.min(...zs);
  const maxZ = Math.max(...zs);

  // Square, because a plane is cheaper than the arithmetic to make it oblong.
  const span = Math.max(maxX - minX, maxZ - minZ) + GROUND_PLANE_MARGIN_METRES * 2;

  return {
    centre: [(minX + maxX) / 2, (minZ + maxZ) / 2],
    size: Math.max(span, GROUND_PLANE_MINIMUM_METRES),
  };
};
