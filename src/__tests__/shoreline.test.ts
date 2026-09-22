import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  SHORELINE_WIDTH_METRES,
  createBankGeometry,
  createShorelineGeometry,
} from '../components/rower3d/bankGeometry';
import { WATER_SURFACE_Y } from '../components/rower3d/waterGeometry';

/**
 * Issue #334 — the water meets the land, rather than stepping down to it.
 *
 * The bank's inner edge sat at `BANK_WATERLINE_Y` (-0.5) while the water
 * surface sat at -0.1, so the shore was a four-centimetre cliff all the way
 * along the route, seen edge-on from a camera two and a half metres up. Both
 * numbers were authored separately and neither knew about the other.
 *
 * They are one number now: the waterline is where the water is.
 */

const straightCurve = () =>
  new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0, 0, -200),
    new THREE.Vector3(0, 0, -400),
  ]);

/** Every vertex of a bank strip, as {x, y, z}. */
const verticesOf = (geometry: THREE.BufferGeometry) => {
  const position = geometry.getAttribute('position') as THREE.BufferAttribute;
  return Array.from({ length: position.count }, (_, i) => ({
    x: position.getX(i),
    y: position.getY(i),
    z: position.getZ(i),
  }));
};

describe('the shore meets the water', () => {
  it.each(['left', 'right'] as const)('puts the %s bank edge at water level', (side) => {
    const vertices = verticesOf(createBankGeometry(straightCurve(), side));

    // The strip is two vertices wide, inner then outer, per sample.
    const inner = vertices.filter((_, i) => i % 2 === 0);
    expect(inner.length, 'no bank was built').toBeGreaterThan(0);

    for (const vertex of inner) {
      expect(
        vertex.y,
        'the shore steps down to the water instead of meeting it',
      ).toBeCloseTo(WATER_SURFACE_Y - 0.02, 5);
    }
  });

  // The outer edge still climbs with the terrain; only the waterline moved.
  it('leaves the far edge free to rise', () => {
    const vertices = verticesOf(createBankGeometry(straightCurve(), 'left'));
    const outer = vertices.filter((_, i) => i % 2 === 1);

    expect(outer.length).toBeGreaterThan(0);
    for (const vertex of outer) {
      expect(vertex.y).toBeGreaterThanOrEqual(WATER_SURFACE_Y - 0.02);
    }
  });
});

describe('the shoreline strip', () => {
  it.each(['left', 'right'] as const)('is a constant width along the %s bank', (side) => {
    const vertices = verticesOf(createShorelineGeometry(straightCurve(), side));
    expect(vertices.length, 'no shoreline was built').toBeGreaterThan(0);

    for (let i = 0; i + 1 < vertices.length; i += 2) {
      const wet = vertices[i];
      const dry = vertices[i + 1];
      const width = Math.hypot(dry.x - wet.x, dry.z - wet.z);
      expect(width, 'the foam line changes width along the bank').toBeCloseTo(
        SHORELINE_WIDTH_METRES,
        2,
      );
    }
  });

  it('lies on the water, not in it or above it', () => {
    const vertices = verticesOf(createShorelineGeometry(straightCurve(), 'left'));

    for (const vertex of vertices) {
      expect(vertex.y).toBeCloseTo(WATER_SURFACE_Y + 0.01, 5);
    }
  });

  // The gradient runs across the strip, so the material can fade from foam at
  // the waterline to nothing on the dry side.
  it('runs its texture across the strip rather than along it', () => {
    const geometry = createShorelineGeometry(straightCurve(), 'left');
    const uv = geometry.getAttribute('uv') as THREE.BufferAttribute;

    expect(uv.getX(0), 'the wet edge is not the start of the gradient').toBe(0);
    expect(uv.getX(1), 'the dry edge is not the end of it').toBe(1);
  });

  it('carries a bounding sphere so the frame loop can cull it', () => {
    expect(createShorelineGeometry(straightCurve(), 'left').boundingSphere).not.toBeNull();
  });
});
