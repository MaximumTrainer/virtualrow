import { describe, expect, it } from 'vitest';
import type { OverpassElement } from '../services/routeEnrichmentService';
import {
  buildWaterMask,
  classifyPoint,
  isLandInWaterArea,
  isWaterArea,
  joinIntoRings,
  pointInPolygon,
  pointInRing,
  polygonsFromElement,
} from '../utils/osmWaterMask';
import type { Coordinate } from '../types/index';

const square = (lat: number, lng: number, size: number): Coordinate[] => [
  { lat, lng },
  { lat, lng: lng + size },
  { lat: lat + size, lng: lng + size },
  { lat: lat + size, lng },
  { lat, lng },
];

const toGeometry = (ring: Coordinate[]) => ring.map(({ lat, lng }) => ({ lat, lon: lng }));

const closedWay = (id: number, ring: Coordinate[], tags: Record<string, string>): OverpassElement => ({
  type: 'way',
  id,
  geometry: toGeometry(ring),
  tags,
});

describe('osmWaterMask — which OSM areas are water (#493 FR14, D16)', () => {
  it.each([
    [{ natural: 'water' }],
    [{ natural: 'water', water: 'lake' }],
    [{ natural: 'water', water: 'river' }],
    [{ waterway: 'riverbank' }],
    [{ landuse: 'reservoir' }],
    [{ landuse: 'basin' }],
    [{ natural: 'bay' }],
    [{ natural: 'strait' }],
    [{ waterway: 'dock' }],
    [{ waterway: 'boatyard' }],
  ])('treats %o as water', (tags) => {
    expect(isWaterArea(tags)).toBe(true);
  });

  it.each([
    [{ waterway: 'river' }],
    [{ landuse: 'forest' }],
    [{ natural: 'wood' }],
    [{}],
  ])('does not treat %o as a water area', (tags) => {
    expect(isWaterArea(tags)).toBe(false);
  });

  it.each([
    [{ place: 'island' }],
    [{ place: 'islet' }],
    [{ natural: 'bare_rock' }],
    [{ natural: 'shoal' }],
    [{ man_made: 'pier' }],
    [{ man_made: 'breakwater' }],
    [{ man_made: 'groyne' }],
  ])('treats %o as land inside water (D17)', (tags) => {
    expect(isLandInWaterArea(tags)).toBe(true);
  });

  it('does not treat a land-use area as land inside water', () => {
    expect(isLandInWaterArea({ landuse: 'residential' })).toBe(false);
  });
});

describe('osmWaterMask — point in polygon, not bounding box (G1)', () => {
  // An L-shaped lake: its bounding box covers the empty top-right corner.
  const lShape: Coordinate[] = [
    { lat: 0, lng: 0 },
    { lat: 0, lng: 2 },
    { lat: 1, lng: 2 },
    { lat: 1, lng: 1 },
    { lat: 2, lng: 1 },
    { lat: 2, lng: 0 },
    { lat: 0, lng: 0 },
  ];

  it('finds a point inside the ring', () => {
    expect(pointInRing({ lat: 0.5, lng: 0.5 }, lShape)).toBe(true);
  });

  it('rejects a point inside the bounding box but outside the shape', () => {
    expect(pointInRing({ lat: 1.5, lng: 1.5 }, lShape)).toBe(false);
  });

  it('treats a point inside an inner ring as outside the polygon', () => {
    const polygon = { outer: square(0, 0, 4), inner: [square(1, 1, 1)] };
    expect(pointInPolygon({ lat: 1.5, lng: 1.5 }, polygon)).toBe(false);
    expect(pointInPolygon({ lat: 3, lng: 3 }, polygon)).toBe(true);
  });
});

describe('osmWaterMask — assembling rings from way segments', () => {
  it('joins open segments end to end, reversing where needed', () => {
    const rings = joinIntoRings([
      [{ lat: 0, lng: 0 }, { lat: 0, lng: 1 }],
      [{ lat: 1, lng: 1 }, { lat: 0, lng: 1 }],
      [{ lat: 1, lng: 1 }, { lat: 1, lng: 0 }, { lat: 0, lng: 0 }],
    ]);
    expect(rings).toHaveLength(1);
    expect(rings[0]).toHaveLength(5);
    expect(rings[0][0]).toEqual(rings[0][rings[0].length - 1]);
  });

  it('drops a chain that never closes', () => {
    expect(joinIntoRings([[{ lat: 0, lng: 0 }, { lat: 0, lng: 1 }]])).toEqual([]);
  });

  it('keeps an already closed way as it is', () => {
    expect(joinIntoRings([square(0, 0, 1)])).toEqual([square(0, 0, 1)]);
  });
});

describe('osmWaterMask — polygons from Overpass elements', () => {
  it('reads a closed way as one polygon with no holes', () => {
    expect(polygonsFromElement(closedWay(1, square(0, 0, 1), { natural: 'water' }))).toEqual([
      { outer: square(0, 0, 1), inner: [] },
    ]);
  });

  it('ignores an open way, which has no area', () => {
    const open: OverpassElement = {
      type: 'way',
      id: 2,
      geometry: toGeometry([{ lat: 0, lng: 0 }, { lat: 0, lng: 1 }]),
      tags: { waterway: 'river' },
    };
    expect(polygonsFromElement(open)).toEqual([]);
  });

  it('assembles a multipolygon relation and puts each island in the lake it sits in', () => {
    const relation: OverpassElement = {
      type: 'relation',
      id: 3,
      tags: { type: 'multipolygon', natural: 'water', water: 'lake' },
      members: [
        // The outer ring arrives as two halves, as large lakes often do.
        { type: 'way', ref: 10, role: 'outer', geometry: toGeometry(square(0, 0, 4).slice(0, 3)) },
        { type: 'way', ref: 11, role: 'outer', geometry: toGeometry(square(0, 0, 4).slice(2)) },
        { type: 'way', ref: 12, role: 'inner', geometry: toGeometry(square(1, 1, 1)) },
        // A second, separate lake in the same relation.
        { type: 'way', ref: 13, role: 'outer', geometry: toGeometry(square(10, 10, 1)) },
      ],
    };
    const polygons = polygonsFromElement(relation);
    expect(polygons).toHaveLength(2);
    const big = polygons.find((p) => p.outer.length === 5 && p.outer[0].lat === 0);
    expect(big?.inner).toEqual([square(1, 1, 1)]);
    expect(polygons.find((p) => p.outer[0].lat === 10)?.inner).toEqual([]);
  });
});

describe('osmWaterMask — classifying a point', () => {
  const lake = closedWay(100, square(0, 0, 4), { natural: 'water', water: 'lake', name: 'Test Lake' });
  const island = closedWay(101, square(2, 2, 1), { place: 'island', name: 'Test Island' });
  const lakeWithHole: OverpassElement = {
    type: 'relation',
    id: 102,
    tags: { type: 'multipolygon', natural: 'water' },
    members: [
      { type: 'way', ref: 1, role: 'outer', geometry: toGeometry(square(10, 10, 4)) },
      { type: 'way', ref: 2, role: 'inner', geometry: toGeometry(square(11, 11, 1)) },
    ],
  };
  const forest = closedWay(103, square(-5, -5, 2), { landuse: 'forest' });
  const mask = buildWaterMask([lake, island, lakeWithHole, forest]);

  it('keeps water areas and land inside water, and nothing else', () => {
    expect(mask.water.map((feature) => feature.id)).toEqual(['relation/102', 'way/100']);
    expect(mask.land.map((feature) => feature.id)).toEqual(['way/101']);
  });

  it('reports open water with the body it belongs to', () => {
    const result = classifyPoint(mask, { lat: 0.5, lng: 0.5 });
    expect(result.kind).toBe('water');
    expect(result.kind === 'water' && result.feature.name).toBe('Test Lake');
  });

  it('reports a mapped island as land, even inside the lake', () => {
    const result = classifyPoint(mask, { lat: 2.5, lng: 2.5 });
    expect(result.kind).toBe('land');
    expect(result.kind === 'land' && result.island?.name).toBe('Test Island');
  });

  it('reports a hole in a multipolygon lake as land', () => {
    expect(classifyPoint(mask, { lat: 11.5, lng: 11.5 }).kind).toBe('land');
  });

  it('reports a point outside every water area as land', () => {
    expect(classifyPoint(mask, { lat: 7, lng: 7 }).kind).toBe('land');
  });

  it('reports unknown when OSM returned no water at all', () => {
    expect(classifyPoint(buildWaterMask([forest]), { lat: 0, lng: 0 }).kind).toBe('unknown');
  });

  it('gives the same answer whatever order Overpass returns features in (G4)', () => {
    const shuffled = buildWaterMask([forest, lakeWithHole, island, lake]);
    for (const point of [{ lat: 0.5, lng: 0.5 }, { lat: 2.5, lng: 2.5 }, { lat: 11.5, lng: 11.5 }]) {
      expect(classifyPoint(shuffled, point)).toEqual(classifyPoint(mask, point));
    }
  });
});
