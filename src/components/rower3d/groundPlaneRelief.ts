import * as THREE from 'three';
import type { PerformanceMode } from './constants';
import type { GroundPlanePlan } from './groundPlane';

/**
 * Relief on the VR-14 ground plane (#431).
 *
 * The plane beyond the bank strip was 1×1 quads and dead flat, so on a long
 * open bend the horizon read as a ruled line where a rolling field should
 * be. This raises the plane to a 64×64 grid and adds ±1.5 m of low-frequency
 * noise on a 40 m wavelength, tapered to zero within 12 m of the waterline
 * so nothing opens a seam with the bank strip (#202/#285/#334).
 *
 * Pure over the curve so a test can iterate the vertices and see the taper
 * hold without a canvas. `low` returns a flat 1×1 quad: the segments only
 * carry the roll, so without it they are cost with nothing to show.
 */

/** Segments per side under auto/high. */
export const GROUND_PLANE_SEGMENTS = 64;
/** Peak displacement, in metres. */
export const GROUND_PLANE_RELIEF_AMPLITUDE_M = 1.5;
/** Wavelength of the noise, in metres. */
export const GROUND_PLANE_RELIEF_WAVELENGTH_M = 40;
/** The plane stays flat within this distance of the waterline. */
export const GROUND_PLANE_RELIEF_TAPER_METRES = 12;

/** A vertex on the ground plane, in world XZ with its Y offset. */
export interface GroundPlaneVertex {
  x: number;
  z: number;
  /** How far above (or below) the plane's mount point this vertex sits. */
  y: number;
}

/**
 * Ground-plane vertices for a plan, curve and tier.
 *
 * Row-major: outer loop over Z, inner over X. The grid has `segments + 1`
 * vertices per side, so a 64-segment plan is 65 × 65 = 4 225 vertices.
 */
export const groundPlaneReliefFor = (
  plan: GroundPlanePlan,
  curve: THREE.CatmullRomCurve3 | null,
  tier: PerformanceMode,
): GroundPlaneVertex[] => {
  const dropRelief = tier === 'basic' || curve === null;
  const segments = dropRelief ? 1 : GROUND_PLANE_SEGMENTS;
  const step = plan.size / segments;
  const x0 = plan.centre[0] - plan.size / 2;
  const z0 = plan.centre[1] - plan.size / 2;

  const routePoints = dropRelief ? null : sampleCurve(curve!);
  const vertices: GroundPlaneVertex[] = [];
  for (let j = 0; j <= segments; j++) {
    for (let i = 0; i <= segments; i++) {
      const x = x0 + i * step;
      const z = z0 + j * step;
      const y = routePoints === null ? 0 : displacementAt(x, z, routePoints);
      vertices.push({ x, z, y });
    }
  }
  return vertices;
};

/**
 * Sampled points along the route, cached implicitly by the curve.
 *
 * 256 is enough that a plane-plan-sized grid never has a vertex whose real
 * nearest curve point lies more than a few metres past a sampled one; the
 * taper's own 12 m window swallows the error.
 */
const sampleCurve = (curve: THREE.CatmullRomCurve3): readonly THREE.Vector3[] =>
  curve.getPoints(256);

const displacementAt = (
  x: number,
  z: number,
  routePoints: readonly THREE.Vector3[],
): number => {
  const dist = distanceToRoute(x, z, routePoints);
  const taper = smoothstep(0, GROUND_PLANE_RELIEF_TAPER_METRES, dist);
  if (taper === 0) return 0;

  const nx = x / GROUND_PLANE_RELIEF_WAVELENGTH_M;
  const nz = z / GROUND_PLANE_RELIEF_WAVELENGTH_M;
  // Two-phase sin/cos: the axis-aligned product alone leaves every peak on a
  // grid, and the second term breaks that regularity without pulling in a
  // dependency. Bounded on [-1, 1] because each summand is bounded on
  // [-0.5, 0.5].
  const noise =
    0.5 * Math.sin(nx * Math.PI * 2) * Math.cos(nz * Math.PI * 2) +
    0.5 * Math.sin((nx + nz) * Math.PI * 1.3 + 1.7);
  return noise * GROUND_PLANE_RELIEF_AMPLITUDE_M * taper;
};

const distanceToRoute = (
  x: number,
  z: number,
  points: readonly THREE.Vector3[],
): number => {
  let min = Infinity;
  for (const p of points) {
    const dx = p.x - x;
    const dz = p.z - z;
    const sq = dx * dx + dz * dz;
    if (sq < min) min = sq;
  }
  return Math.sqrt(min);
};

const smoothstep = (a: number, b: number, x: number): number => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * A world-space, un-rotated ground-plane geometry, mounted at y = 0.
 *
 * The caller places it at `GROUND_PLANE_Y` — a plane with real relief no
 * longer maps cleanly through a `-PI/2` rotation on x, so this returns
 * horizontal geometry that needs no rotation at all. Y is the displacement
 * from the `groundPlaneReliefFor` vertices; the mount point takes care of
 * the absolute waterline offset.
 */
export const buildGroundPlaneGeometry = (
  vertices: readonly GroundPlaneVertex[],
  segments: number,
): THREE.BufferGeometry => {
  const positions = new Float32Array(vertices.length * 3);
  for (let i = 0; i < vertices.length; i++) {
    positions[i * 3 + 0] = vertices[i].x;
    positions[i * 3 + 1] = vertices[i].y;
    positions[i * 3 + 2] = vertices[i].z;
  }

  const perSide = segments + 1;
  const quadCount = segments * segments;
  const indices = new Uint32Array(quadCount * 6);
  let k = 0;
  for (let j = 0; j < segments; j++) {
    for (let i = 0; i < segments; i++) {
      const a = j * perSide + i;
      const b = a + 1;
      const c = a + perSide;
      const d = c + 1;
      indices[k++] = a;
      indices[k++] = c;
      indices[k++] = b;
      indices[k++] = b;
      indices[k++] = c;
      indices[k++] = d;
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeVertexNormals();
  return geometry;
};

/** The segment count that matches `groundPlaneReliefFor` for a tier and curve. */
export const groundPlaneSegmentsFor = (
  tier: PerformanceMode,
  curve: THREE.CatmullRomCurve3 | null,
): number => (tier === 'basic' || curve === null ? 1 : GROUND_PLANE_SEGMENTS);
