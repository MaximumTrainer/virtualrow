import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Coordinate } from '../lib/types/index';
import type { OverpassElement } from '../lib/services/routeEnrichmentService';
import {
  clipRingToBox,
  LAKE_POLYGON_STORE_VERTICES,
  lakePolygonsFor,
  simplifyRing,
  vertexCount,
} from '../lib/utils/lakePolygons';
import { polygonsFromElement, type MaskBounds, type MaskFeature } from '../lib/utils/osmWaterMask';
import { runRouteDetection } from '../lib/utils/routeDetection';

/**
 * #493 Phase 3 (FR1, D2 a, D4 c): the lake outlines a lake route keeps, clipped
 * to the area around the route and slimmed for storage (NFR3).
 */

const M = 1 / 111_320;
const at = (x: number, y: number): Coordinate => ({ lat: y * M, lng: x * M });
const box = (x0: number, y0: number, x1: number, y1: number) => [at(x0, y0), at(x1, y0), at(x1, y1), at(x0, y1), at(x0, y0)];
const bounds = (x0: number, y0: number, x1: number, y1: number): MaskBounds => ({
  minLat: y0 * M,
  minLng: x0 * M,
  maxLat: y1 * M,
  maxLng: x1 * M,
});
const feature = (id: string, outer: Coordinate[], inner: Coordinate[][] = []): MaskFeature => ({
  id,
  tags: { natural: 'water', water: 'lake' },
  polygons: [{ outer, inner }],
});

const closed = (ring: Coordinate[]) => ring[0].lat === ring[ring.length - 1].lat && ring[0].lng === ring[ring.length - 1].lng;

describe('#493 Phase 3 lake outlines', () => {
  it('clips a ring to a box, closed, with the box edge where it was cut', () => {
    const clipped = clipRingToBox(box(-100, -100, 100, 100), bounds(0, -200, 200, 200));
    expect(closed(clipped)).toBe(true);
    const xs = clipped.map((point) => point.lng / M);
    expect(Math.min(...xs)).toBeCloseTo(0, 6);
    expect(Math.max(...xs)).toBeCloseTo(100, 6);
  });

  it('drops a ring wholly outside the box', () => {
    expect(clipRingToBox(box(500, 500, 600, 600), bounds(0, 0, 100, 100))).toEqual([]);
  });

  it('simplifies a ring to a vertex budget, closed and in order', () => {
    const circle = Array.from({ length: 400 }, (_, i) => at(100 * Math.cos((i / 400) * 2 * Math.PI), 100 * Math.sin((i / 400) * 2 * Math.PI)));
    const ring = [...circle, circle[0]];
    const slim = simplifyRing(ring, 50);
    expect(slim.length).toBeLessThanOrEqual(50);
    expect(closed(slim)).toBe(true);
    expect(slim.slice(0, -1).every((point) => ring.includes(point))).toBe(true);
    expect(simplifyRing(ring, 1000)).toEqual(ring);
  });

  it('keeps a lake with its islands inside the box and drops islands outside it', () => {
    const near = box(10, 10, 30, 30);
    const far = box(800, 800, 820, 820);
    const [lake] = lakePolygonsFor([feature('relation/1', box(-1000, -1000, 1000, 1000), [near, far])], bounds(-200, -200, 200, 200));
    expect(lake.featureId).toBe('relation/1');
    expect(lake.inner).toHaveLength(1);
    expect(Math.max(...lake.outer.map((point) => point.lng / M))).toBeCloseTo(200, 1);
  });

  it('shares the vertex budget across rings and rounds coordinates', () => {
    const wiggly = (n: number, r: number) => {
      const ring = Array.from({ length: n }, (_, i) => at(r * Math.cos((i / n) * 2 * Math.PI) * (1 + 0.05 * (i % 2)), r * Math.sin((i / n) * 2 * Math.PI)));
      return [...ring, ring[0]];
    };
    const lakes = lakePolygonsFor([feature('way/1', wiggly(3000, 500), [wiggly(800, 50)])], bounds(-1000, -1000, 1000, 1000), 600);
    expect(vertexCount(lakes)).toBeLessThanOrEqual(600);
    expect(lakes[0].inner).toHaveLength(1);
    expect(lakes[0].outer.every(({ lat, lng }) => Number(lat.toFixed(7)) === lat && Number(lng.toFixed(7)) === lng)).toBe(true);
  });

  it('keeps the closed ways of a relation whose outline was cut off, and drops the open pieces (D4 c)', () => {
    const toGeometry = (ring: Coordinate[]) => ring.map(({ lat, lng }) => ({ lat, lon: lng }));
    const partial: OverpassElement = {
      type: 'relation',
      id: 9,
      tags: { natural: 'water', water: 'lake', type: 'multipolygon' },
      members: [
        { type: 'way', ref: 4, role: 'outer', geometry: toGeometry([at(0, 0), at(500, 0), at(500, 500)]) },
        { type: 'way', ref: 5, role: 'outer', geometry: toGeometry(box(100, 100, 300, 300)) },
      ],
    };
    expect(polygonsFromElement(partial)).toEqual([{ outer: box(100, 100, 300, 300), inner: [] }]);
  });
});

interface WaterFixture {
  route: Coordinate[];
  bounds: MaskBounds;
  elements: OverpassElement[];
}
const fixture = (id: number) =>
  JSON.parse(readFileSync(join(process.cwd(), 'src/__tests__/fixtures/osm', `${id}.json`), 'utf8')) as WaterFixture;
const detect = (id: number) => {
  const { route, bounds: box, elements } = fixture(id);
  return runRouteDetection({ coordinates: route, elements, coastlineBounds: box });
};

describe('#493 Phase 3 lakes on the reference courses (D2 a)', () => {
  it('keeps Lake Quinsigamond for course 1, with its islands, inside the storage budget', () => {
    const { lakes } = detect(1);
    expect(new Set(lakes.map((lake) => lake.featureId))).toEqual(new Set(['relation/1272518']));
    expect(lakes[0].name).toBe('Lake Quinsigamond');
    expect(lakes[0].inner.length).toBeGreaterThan(0);
    expect(vertexCount(lakes)).toBeLessThanOrEqual(LAKE_POLYGON_STORE_VERTICES);
  });

  it('keeps only the lake water on course 237, not the Montlake Cut', () => {
    const { lakes } = detect(237);
    const ids = lakes.map((lake) => lake.featureId);
    expect(ids).not.toContain('relation/2793830');
    expect(ids.length).toBeGreaterThan(0);
    expect(vertexCount(lakes)).toBeLessThanOrEqual(LAKE_POLYGON_STORE_VERTICES);
    expect(JSON.stringify(lakes).length).toBeLessThan(128 * 1024);
  });

  it.each([61, 153, 175, 179, 257, 277])('keeps no lake outline for course %i, which is not a lake route', (id) => {
    expect(detect(id).lakes).toEqual([]);
  });
});
