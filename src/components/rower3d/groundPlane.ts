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

/**
 * How far below the waterline the ground plane sits, in metres.
 *
 * Far enough to be under the bank's inner edge, and no further: it is the
 * absence of a hole, not a riverbed, and a deep one would show as a step where
 * the bank strip runs out on a bend.
 */
export const GROUND_PLANE_DROP_METRES = 0.05;

/**
 * How hard to push the ground plane back in the depth buffer (#328).
 *
 * Five centimetres of separation is nothing against a depth buffer stretched
 * from a 0.1 m near plane to a 12 km far one, so which of the plane and the
 * water won a given pixel depended on where the camera was standing. Moving
 * the chase camera one metre back handed it the whole river.
 *
 * The offset settles that tie in the water's favour at every distance, and
 * costs nothing: the plane is flat, unlit and only ever seen where there is
 * nothing else to see.
 */
export const GROUND_PLANE_DEPTH_OFFSET = 8;
