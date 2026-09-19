import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { BANK_WATERLINE_Y, createBankGeometry } from '../components/rower3d/bankGeometry';
import { stripSegmentCount } from '../components/rower3d/routeStripGeometry';
import { facingAway } from './faceNormals';
import { createRouteCurve } from '../components/rower3d/curve';
import type { Coordinate } from '../types/index';
import {
  MAX_TERRAIN_RELIEF_SCENE_UNITS,
  type RouteEnrichmentData,
} from '../services/routeEnrichmentService';

/**
 * Proves the OpenTopoData elevations reach the geometry the rower actually
 * sees (#202). Before this, `elevations` was fetched on every cache miss and
 * read by nothing, so a flat canal and an alpine course drew identical banks.
 */

const straightCurve = () =>
  new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0, 0, -50),
    new THREE.Vector3(0, 0, -100),
    new THREE.Vector3(0, 0, -150),
  ]);

const enrichmentWith = (elevations: number[]): RouteEnrichmentData => ({
  routeId: 'terrain-fixture',
  elevations,
  segmentProfiles: [],
  waterBodyType: 'river',
  waterWidthMeters: 20,
  waterColor: '#3a6b7d',
  waveIntensity: 1,
  fetchedAt: Date.now(),
  source: 'network',
});

/** Outer-edge vertices are the odd ones; each segment pushes inner then outer. */
const outerHeights = (geometry: THREE.BufferGeometry): number[] => {
  const position = geometry.getAttribute('position');
  const heights: number[] = [];
  for (let i = 1; i < position.count; i += 2) {
    heights.push(position.getY(i));
  }
  return heights;
};

const innerHeights = (geometry: THREE.BufferGeometry): number[] => {
  const position = geometry.getAttribute('position');
  const heights: number[] = [];
  for (let i = 0; i < position.count; i += 2) {
    heights.push(position.getY(i));
  }
  return heights;
};

describe('riverbank terrain relief (#202)', () => {
  it('draws a flat bank when there is no enrichment at all', () => {
    const geometry = createBankGeometry(straightCurve(), 'left');

    expect(outerHeights(geometry).every((y) => y === BANK_WATERLINE_Y)).toBe(true);
    geometry.dispose();
  });

  it('draws a flat bank for the all-zero elevations the fallback produces', () => {
    // createFallbackRouteEnrichment fills elevations with zeros. A route that
    // never reached OpenTopoData must render exactly as it did before.
    const geometry = createBankGeometry(straightCurve(), 'left', { enrichment: enrichmentWith([0, 0, 0, 0]) });

    expect(outerHeights(geometry).every((y) => y === BANK_WATERLINE_Y)).toBe(true);
    geometry.dispose();
  });

  it('raises the bank where the real terrain climbs', () => {
    const geometry = createBankGeometry(
      straightCurve(),
      'left',
      { enrichment: enrichmentWith([0, 50, 100, 150]) },
    );
    const heights = outerHeights(geometry);

    expect(heights[0]).toBeCloseTo(BANK_WATERLINE_Y, 6);
    expect(heights[heights.length - 1]).toBeGreaterThan(BANK_WATERLINE_Y);
    // A monotonic climb upstream should produce a monotonic bank.
    for (let i = 1; i < heights.length; i++) {
      expect(heights[i]).toBeGreaterThanOrEqual(heights[i - 1] - 1e-6);
    }
    geometry.dispose();
  });

  it('keeps the inner edge on the waterline however steep the terrain', () => {
    // Anything else opens a gap between the bank and the water plane.
    const geometry = createBankGeometry(
      straightCurve(),
      'right',
      { enrichment: enrichmentWith([0, 400, 900, 1500]) },
    );

    expect(innerHeights(geometry).every((y) => y === BANK_WATERLINE_Y)).toBe(true);
    geometry.dispose();
  });

  it('clamps an extreme course so the bank cannot wall the rower in', () => {
    const geometry = createBankGeometry(
      straightCurve(),
      'left',
      { enrichment: enrichmentWith([0, 100000, 200000, 300000]) },
    );
    const ceiling = BANK_WATERLINE_Y + MAX_TERRAIN_RELIEF_SCENE_UNITS;

    expect(Math.max(...outerHeights(geometry))).toBeLessThanOrEqual(ceiling + 1e-6);
    geometry.dispose();
  });

  it('emits finite positions and normals for every vertex', () => {
    // A NaN anywhere in the buffer silently blanks the mesh at runtime.
    const geometry = createBankGeometry(
      straightCurve(),
      'left',
      { enrichment: enrichmentWith([12, Number.NaN, 80, 45]) },
    );

    const position = geometry.getAttribute('position');
    const normal = geometry.getAttribute('normal');

    expect(position.count).toBe((stripSegmentCount(straightCurve()) + 1) * 2);
    expect(normal).toBeDefined();
    for (let i = 0; i < position.count; i++) {
      expect(Number.isFinite(position.getX(i))).toBe(true);
      expect(Number.isFinite(position.getY(i))).toBe(true);
      expect(Number.isFinite(position.getZ(i))).toBe(true);
      expect(Number.isFinite(normal.getX(i))).toBe(true);
      expect(Number.isFinite(normal.getY(i))).toBe(true);
      expect(Number.isFinite(normal.getZ(i))).toBe(true);
    }
    geometry.dispose();
  });

  it('computes normals that tilt with the slope instead of pointing straight up', () => {
    const flat = createBankGeometry(straightCurve(), 'left', { enrichment: enrichmentWith([0, 0, 0, 0]) });
    const sloped = createBankGeometry(straightCurve(), 'left', { enrichment: enrichmentWith([0, 60, 120, 180]) });

    const flatNormal = flat.getAttribute('normal');
    const slopedNormal = sloped.getAttribute('normal');

    // Sample a mid-strip vertex: flat stays vertical, sloped does not.
    const sample = 100;
    expect(Math.abs(flatNormal.getY(sample))).toBeCloseTo(1, 5);
    expect(Math.abs(slopedNormal.getY(sample))).toBeLessThan(1);

    flat.dispose();
    sloped.dispose();
  });
});

describe('both banks face the sky (#269)', () => {
  /**
   * The right bank was invisible, and the published hero showed it: water blue,
   * the left bank green, and the whole right side of the river the same near
   * white as the sky.
   *
   * The two banks are mirror images - `outward` is -1 on the left and +1 on the
   * right - but both were wound the same way round. Mirroring a triangle
   * reverses which way it faces, so the right bank pointed away from the world
   * and MeshPhysicalMaterial, which culls back faces by default, drew nothing.
   * computeVertexNormals would have lit it from underneath in any case.
   *
   * Asserted on the winding rather than on a rendered frame: this is a property
   * of the index buffer and needs no WebGL context to check.
   */
  const faceNormals = (geometry: THREE.BufferGeometry): THREE.Vector3[] => {
    const position = geometry.getAttribute('position');
    const index = geometry.getIndex();
    if (!index) throw new Error('the bank geometry is expected to be indexed');

    const normals: THREE.Vector3[] = [];
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const c = new THREE.Vector3();
    for (let i = 0; i < index.count; i += 3) {
      a.fromBufferAttribute(position, index.getX(i));
      b.fromBufferAttribute(position, index.getX(i + 1));
      c.fromBufferAttribute(position, index.getX(i + 2));
      // Three winds counter-clockwise, so (b-a) x (c-a) points out of the face.
      normals.push(
        new THREE.Vector3()
          .subVectors(b, a)
          .cross(new THREE.Vector3().subVectors(c, a))
          .normalize(),
      );
    }
    return normals;
  };

  for (const side of ['left', 'right'] as const) {
    it(`points the ${side} bank upwards, so it is not culled away`, () => {
      const normals = faceNormals(createBankGeometry(straightCurve(), side));

      expect(normals.length, 'no triangles were built').toBeGreaterThan(0);
      const downward = normals.filter((n) => n.y <= 0).length;
      expect(
        downward,
        `${downward} of ${normals.length} ${side}-bank triangles face away from the sky`,
      ).toBe(0);
    });
  }

  it('winds the two banks in opposite directions, because they are mirrored', () => {
    const left = createBankGeometry(straightCurve(), 'left').getIndex();
    const right = createBankGeometry(straightCurve(), 'right').getIndex();

    expect(left, 'the left bank is expected to be indexed').not.toBeNull();
    expect(right, 'the right bank is expected to be indexed').not.toBeNull();
    // Same vertices in the same places, opposite order: that is what mirroring
    // a surface means, and it is the half that was missing.
    expect(
      [right!.getX(0), right!.getX(1), right!.getX(2)],
      'the banks are wound the same way, so one of them faces backwards',
    ).not.toEqual([left!.getX(0), left!.getX(1), left!.getX(2)]);
  });
});

describe('banks survive a bend (#285)', () => {
  /**
   * The winding fix in #269 was proved on a straight, which is the one case
   * that cannot fail. An offset curve inside a turn shrinks, and at an offset
   * equal to the radius of curvature it turns inside out - so on a bend the
   * inside bank was being culled away: 32 of 500 triangles over three bends in
   * 3 km, and far more as the bends tighten.
   *
   * The builder now holds the bank short of that fold and smooths the reach
   * along the route, because clamping each sample on its own made the outer
   * edge jump and a quad with a step in it is folded whatever its winding says.
   *
   * What this does not claim is a guarantee at any curvature. A strip two
   * vertices wide cannot be offset further than the radius without folding, and
   * tightening the clamp makes it worse rather than better. Beyond a point the
   * centreline itself is the limit - at twelve bends in 3 km the water channel
   * folds too, which is a deeper question than the banks. The material is
   * double-sided so the residue costs overdraw rather than showing sky through
   * the ground; see the material in bankComponents.tsx.
   */
  const windingRiver = (meters: number, bends: number) => {
    const points: Coordinate[] = [];
    const samples = 60;
    for (let i = 0; i <= samples; i += 1) {
      const t = i / samples;
      points.push({
        lat: 51.45 + (t * meters) / 111_195,
        lng: (Math.sin(t * bends * 2 * Math.PI) * 45) / 70_000,
      });
    }
    return createRouteCurve(points, 0.1)!;
  };

  it('keeps every triangle facing the sky on a river-shaped bend', () => {
    // Three bends in 3 km with a 45 m wander: a meander, not a slalom.
    const curve = windingRiver(3000, 3);

    for (const side of ['left', 'right'] as const) {
      const away = facingAway(createBankGeometry(curve, side));
      expect(away, `${away} ${side}-bank triangles face away from the sky`).toBe(0);
    }
  });

  it('narrows the bank as the bend tightens, rather than reaching through it', () => {
    // What the clamp does, stated as a measurement: the same river wound
    // tighter must be given a narrower bank, because the fold is closer.
    const widthOn = (bends: number) => {
      const position = createBankGeometry(windingRiver(3000, bends), 'left').getAttribute(
        'position',
      );
      let total = 0;
      let samples = 0;
      for (let i = 0; i < position.count; i += 2) {
        total += Math.hypot(
          position.getX(i + 1) - position.getX(i),
          position.getZ(i + 1) - position.getZ(i),
        );
        samples += 1;
      }
      return total / samples;
    };

    const gentle = widthOn(3);
    const tight = widthOn(12);

    expect(tight, 'a tighter bend was given the same bank as a gentle one').toBeLessThan(gentle);
  });
});
