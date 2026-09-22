import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  GROUND_PLANE_MARGIN_METRES,
  GROUND_PLANE_MINIMUM_METRES,
  groundPlaneFor,
} from '../components/rower3d/groundPlane';

/**
 * Issue #334 — there is ground everywhere the rower can see.
 *
 * The banks are strips whose outer reach is clamped on bends (#285), and past
 * that reach there was nothing: the canvas cleared to transparent and the
 * page's own CSS gradient showed through, as white tears between the bank and
 * the horizon on every bend.
 *
 * What makes this worth a pure test rather than a look at the screen is that
 * the failure is invisible until someone rows to the end of a long route. A
 * plane centred on the origin covers a route that starts there and goes one
 * way for six kilometres only half the time.
 */

/** A route running away from the origin, as a real one does. */
const offsetRoute = (fromX: number, toX: number) =>
  new THREE.CatmullRomCurve3([
    new THREE.Vector3(fromX, 0, 0),
    new THREE.Vector3((fromX + toX) / 2, 0, -100),
    new THREE.Vector3(toX, 0, -200),
  ]);

/** Whether a plane of this plan contains a point, in the XZ plane. */
const covers = (plan: ReturnType<typeof groundPlaneFor>, x: number, z: number) => {
  const half = plan.size / 2;
  return (
    Math.abs(x - plan.centre[0]) <= half && Math.abs(z - plan.centre[1]) <= half
  );
};

describe('groundPlaneFor', () => {
  it('covers a route that runs away from the origin', () => {
    const plan = groundPlaneFor(offsetRoute(3000, 9000));

    expect(covers(plan, 3000, 0), 'the start of the route is off the world').toBe(true);
    expect(covers(plan, 9000, -200), 'the end of the route is off the world').toBe(true);
  });

  it('reaches a margin past the furthest the rower can get', () => {
    const plan = groundPlaneFor(offsetRoute(0, 1000));

    // As far past the end as the fog can see, so its own edge is never in shot.
    expect(covers(plan, 1000 + GROUND_PLANE_MARGIN_METRES - 1, 0)).toBe(true);
  });

  it('builds something even before there is a route', () => {
    const plan = groundPlaneFor(null);

    expect(plan.centre).toEqual([0, 0]);
    expect(plan.size).toBe(GROUND_PLANE_MINIMUM_METRES);
  });

  it('does not shrink below the minimum for a very short route', () => {
    expect(groundPlaneFor(offsetRoute(0, 10)).size).toBeGreaterThanOrEqual(
      GROUND_PLANE_MINIMUM_METRES,
    );
  });
});
