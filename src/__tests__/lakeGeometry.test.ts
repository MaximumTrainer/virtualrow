import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as THREE from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createLakeLandGeometry,
  createLakeWaterGeometry,
  isLakeOutlineEnabled,
  LAKE_SHORE_RISE_METERS,
  projectRing,
  publishLakeVertices,
} from '../components/rower3d/lakeGeometry';
import { BANK_WATERLINE_Y } from '../components/rower3d/bankGeometry';
import { WATER_SURFACE_Y } from '../components/rower3d/waterGeometry';
import type { OverpassElement } from '../services/routeEnrichmentService';
import type { Coordinate } from '../types/index';
import type { LakePolygon } from '../utils/lakePolygons';
import type { MaskBounds } from '../utils/osmWaterMask';
import { runRouteDetection } from '../utils/routeDetection';

/**
 * #493 Phase 3 (FR4, FR5, FR6, AC14, NFR7): a lake drawn from its outline,
 * asserted on the geometry without a WebGL context.
 */

const M = 1 / 111_320;
const origin: Coordinate = { lat: 0, lng: 0 };
const at = (x: number, y: number): Coordinate => ({ lat: y * M, lng: x * M });
const square = (x0: number, y0: number, x1: number, y1: number) => [at(x0, y0), at(x1, y0), at(x1, y1), at(x0, y1), at(x0, y0)];

// 400 m square of water around the origin, with a 40 m island at (100, 100) m.
const lake: LakePolygon = {
  featureId: 'way/1',
  outer: square(-200, -200, 200, 200),
  inner: [square(80, 80, 120, 120)],
};

const triangles = (geometry: THREE.BufferGeometry) => {
  const position = geometry.getAttribute('position');
  const index = geometry.getIndex()!;
  const vertex = (i: number) => new THREE.Vector3().fromBufferAttribute(position, index.getX(i));
  return Array.from({ length: index.count / 3 }, (_, t) => [vertex(t * 3), vertex(t * 3 + 1), vertex(t * 3 + 2)] as const);
};

const faceNormal = ([a, b, c]: readonly [THREE.Vector3, THREE.Vector3, THREE.Vector3]) =>
  new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a));

const areaXZ = (geometry: THREE.BufferGeometry) =>
  triangles(geometry).reduce((sum, [a, b, c]) => sum + Math.abs((b.x - a.x) * (c.z - a.z) - (c.x - a.x) * (b.z - a.z)) / 2, 0);

const covers = (geometry: THREE.BufferGeometry, x: number, z: number) =>
  triangles(geometry).some(([a, b, c]) => {
    const side = (p: THREE.Vector3, q: THREE.Vector3) => (q.x - p.x) * (z - p.z) - (q.z - p.z) * (x - p.x);
    const [d1, d2, d3] = [side(a, b), side(b, c), side(c, a)];
    return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
  });

describe('#493 Phase 3 lake outline flag (NFR7)', () => {
  afterEach(() => {
    delete window.__VIRTUALROW_LAKE_OUTLINES;
  });

  it('is on unless the window flag turns it off', () => {
    expect(isLakeOutlineEnabled()).toBe(true);
    window.__VIRTUALROW_LAKE_OUTLINES = true;
    expect(isLakeOutlineEnabled()).toBe(true);
    window.__VIRTUALROW_LAKE_OUTLINES = false;
    expect(isLakeOutlineEnabled()).toBe(false);
  });
});

describe('#493 Phase 3 lake projection', () => {
  it('puts the route origin at zero, east on +x and north on -z, without the closing repeat', () => {
    const ring = projectRing(square(0, 0, 100, 100), origin);
    expect(ring).toHaveLength(4);
    expect(ring[0].x).toBeCloseTo(0, 6);
    expect(ring[1].x).toBeCloseTo(100, 0);
    expect(ring[2].y).toBeCloseTo(-100, 0);
  });
});

describe('#493 Phase 3 lake water (FR4, AC14)', () => {
  const water = createLakeWaterGeometry([lake], origin);

  it('is flat at the water height and faces the sky', () => {
    const position = water.getAttribute('position');
    for (let i = 0; i < position.count; i++) expect(position.getY(i)).toBeCloseTo(WATER_SURFACE_Y, 6);
    expect(triangles(water).every((triangle) => faceNormal(triangle).y > 0)).toBe(true);
  });

  it('covers the lake and leaves the island dry', () => {
    expect(areaXZ(water)).toBeCloseTo(400 * 400 - 40 * 40, -2);
    expect(covers(water, 0, 0)).toBe(true);
    expect(covers(water, 100, -100)).toBe(false);
    expect(covers(water, 300, 0)).toBe(false);
  });

  it('builds nothing from no lake', () => {
    expect(createLakeWaterGeometry([], origin).getAttribute('position').count).toBe(0);
  });
});

describe('#493 Phase 3 lake shore and islands (FR5, FR6, D6 a)', () => {
  const land = createLakeLandGeometry([lake], origin, { width: 30 });
  const position = land.getAttribute('position');
  const points = Array.from({ length: position.count }, (_, i) => new THREE.Vector3().fromBufferAttribute(position, i));

  it('climbs from the waterline away from the water, facing the sky', () => {
    expect(Math.min(...points.map((point) => point.y))).toBeCloseTo(BANK_WATERLINE_Y, 6);
    expect(Math.max(...points.map((point) => point.y))).toBeCloseTo(BANK_WATERLINE_Y + LAKE_SHORE_RISE_METERS, 6);
    expect(triangles(land).every((triangle) => faceNormal(triangle).y > 0)).toBe(true);
    // The shore band runs out to 30 m beyond the 200 m square, never into the lake.
    expect(Math.max(...points.map((point) => point.x))).toBeCloseTo(230, 0);
    expect(covers(land, 0, 0)).toBe(false);
    expect(covers(land, 215, 0)).toBe(true);
  });

  it('draws the island as land, with a top inside its shore', () => {
    expect(covers(land, 100, -100)).toBe(true);
    const top = points.filter((point) => Math.abs(point.y - (BANK_WATERLINE_Y + LAKE_SHORE_RISE_METERS)) < 1e-6 && point.x > 70 && point.x < 130);
    expect(top.length).toBeGreaterThan(0);
    expect(top.every((point) => point.x >= 80 && point.x <= 120 && point.z <= -80 && point.z >= -120)).toBe(true);
  });

  it('carries the bank material\'s attributes', () => {
    expect(land.getAttribute('uv')).toBeDefined();
    expect(land.getAttribute('shoreDist')).toBeDefined();
    expect(land.getAttribute('normal')).toBeDefined();
  });
});

describe('#493 Phase 3 lake geometry on Lake Quinsigamond (course 1)', () => {
  const fixture = JSON.parse(readFileSync(join(process.cwd(), 'src/__tests__/fixtures/osm/1.json'), 'utf8')) as {
    route: Coordinate[];
    bounds: MaskBounds;
    elements: OverpassElement[];
  };
  const { lakes } = runRouteDetection({ coordinates: fixture.route, elements: fixture.elements, coastlineBounds: fixture.bounds });

  it('builds water under every route point and land around it, with no broken vertices', () => {
    const water = createLakeWaterGeometry(lakes, fixture.route[0]);
    const land = createLakeLandGeometry(lakes, fixture.route[0]);
    for (const geometry of [water, land]) {
      const position = geometry.getAttribute('position');
      expect(position.count).toBeGreaterThan(0);
      expect(Array.from(position.array as Float32Array).every(Number.isFinite)).toBe(true);
    }
    const onWater = fixture.route.filter((point) => {
      const [p] = projectRing([point], fixture.route[0]);
      return covers(water, p.x, p.y);
    });
    // NFR8 found 69% of course 1's route points on mapped water: the straight
    // line between its gates cuts across the bends.
    expect(onWater.length / fixture.route.length).toBeGreaterThanOrEqual(0.69);
  });
});

describe('#493 AC5 lake vertex telemetry', () => {
  afterEach(() => {
    delete window.__VIRTUALROW_TELEMETRY;
    delete window.__ROWER3D_LAKE;
  });

  // 5 + 5 vertices: the square's outer ring and its island, closing repeats included.
  const island = (x: number): LakePolygon => ({ featureId: 'way/2', outer: square(x, 0, x + 10, 10), inner: [] });

  it('publishes nothing unless telemetry is on', () => {
    publishLakeVertices([lake], 'high');
    expect(window.__ROWER3D_LAKE).toBeUndefined();
  });

  it('publishes the drawn vertex count against the tier cap', () => {
    window.__VIRTUALROW_TELEMETRY = true;
    publishLakeVertices([lake], 'basic');
    expect(window.__ROWER3D_LAKE).toEqual({ performanceMode: 'basic', cap: 256, vertices: 10, peakVertices: 10 });
  });

  it('counts nothing drawn as zero', () => {
    window.__VIRTUALROW_TELEMETRY = true;
    publishLakeVertices(undefined, 'high');
    expect(window.__ROWER3D_LAKE).toMatchObject({ vertices: 0, peakVertices: 0, cap: 1024 });
  });

  it('keeps the most any frame drew at the tier, and starts again on a new tier', () => {
    window.__VIRTUALROW_TELEMETRY = true;
    publishLakeVertices([lake, island(300)], 'high');
    publishLakeVertices([lake], 'high');
    expect(window.__ROWER3D_LAKE).toMatchObject({ vertices: 10, peakVertices: 15 });
    publishLakeVertices([lake], 'basic');
    expect(window.__ROWER3D_LAKE).toMatchObject({ performanceMode: 'basic', vertices: 10, peakVertices: 10 });
  });
});
