import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  GROUND_PLANE_RELIEF_AMPLITUDE_M,
  GROUND_PLANE_RELIEF_TAPER_METRES,
  GROUND_PLANE_SEGMENTS,
  groundPlaneReliefFor,
} from '../components/rower3d/groundPlaneRelief';
import { groundPlaneFor } from '../components/rower3d/groundPlane';

/**
 * Issue #431 — the field beyond the bank is not a mirror-flat sheet.
 *
 * VR-14's ground plane is one big quad. #202 gives the bank strip real
 * elevations, but past the bank strip the world reads as glass, and on a
 * long open bend the horizon is a straight line where a rolling field
 * should be. This adds low-frequency vertex noise on a 64×64 grid, tapered
 * to zero within 12 m of the waterline so it never opens a seam with the
 * bank strip.
 */

const routeAlongX = () =>
  new THREE.CatmullRomCurve3([
    new THREE.Vector3(-400, 0, 0),
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(400, 0, 0),
  ]);

const distanceToRoute = (x: number, z: number, curve: THREE.CatmullRomCurve3) => {
  const points = curve.getPoints(256);
  let min = Infinity;
  for (const p of points) {
    const d = Math.hypot(p.x - x, p.z - z);
    if (d < min) min = d;
  }
  return min;
};

describe('groundPlaneReliefFor (#431)', () => {
  it('lays out a 64×64 grid at auto', () => {
    const curve = routeAlongX();
    const plan = groundPlaneFor(curve);

    const vertices = groundPlaneReliefFor(plan, curve, 'auto');

    const expected = (GROUND_PLANE_SEGMENTS + 1) ** 2;
    expect(vertices.length).toBe(expected);
  });

  it('holds every vertex within the taper distance at y = 0', () => {
    const curve = routeAlongX();
    const plan = groundPlaneFor(curve);

    const vertices = groundPlaneReliefFor(plan, curve, 'auto');

    for (const v of vertices) {
      const dist = distanceToRoute(v.x, v.z, curve);
      if (dist < GROUND_PLANE_RELIEF_TAPER_METRES) {
        expect(
          Math.abs(v.y),
          `a vertex ${dist.toFixed(1)} m from the water is at y = ${v.y}`,
        ).toBeLessThan(0.01);
      }
    }
  });

  it('keeps every vertex within the amplitude', () => {
    const curve = routeAlongX();
    const plan = groundPlaneFor(curve);

    const vertices = groundPlaneReliefFor(plan, curve, 'auto');

    for (const v of vertices) {
      expect(Math.abs(v.y)).toBeLessThanOrEqual(GROUND_PLANE_RELIEF_AMPLITUDE_M + 1e-6);
    }
  });

  it('actually displaces the field past the taper', () => {
    const curve = routeAlongX();
    const plan = groundPlaneFor(curve);

    const vertices = groundPlaneReliefFor(plan, curve, 'auto');

    const displaced = vertices.filter((v) => Math.abs(v.y) > 0.1);
    // A 64×64 grid over a kilometres-wide plan puts most vertices well past
    // the 12 m taper. If almost none are displaced the mask has swallowed
    // the whole plane, and the FR is defeated.
    expect(displaced.length).toBeGreaterThan(500);
  });

  it('returns a flat plane at low', () => {
    const curve = routeAlongX();
    const plan = groundPlaneFor(curve);

    const vertices = groundPlaneReliefFor(plan, curve, 'low');

    for (const v of vertices) {
      expect(v.y).toBe(0);
    }
  });

  it('returns a flat plane when there is no route yet', () => {
    const plan = groundPlaneFor(null);

    const vertices = groundPlaneReliefFor(plan, null, 'auto');

    for (const v of vertices) {
      expect(v.y).toBe(0);
    }
  });

  it('is deterministic — the same route builds the same vertices', () => {
    const curve = routeAlongX();
    const plan = groundPlaneFor(curve);

    const a = groundPlaneReliefFor(plan, curve, 'auto');
    const b = groundPlaneReliefFor(plan, curve, 'auto');

    expect(a).toEqual(b);
  });
});
