// ============================================================================
// WATER / LAND MASK FROM OSM GEOMETRY (#493 FR14)
//
// Enrichment used to decide "is this water" by bounding box (G1): a point
// inside a curved river's or a lake's bbox matched it even when it was on the
// bank. This reads the real shapes out of the Overpass response instead —
// closed ways and multipolygon relations — and answers by point-in-polygon.
//
// Pure, no I/O, so detection can be checked against recorded responses
// without a network or a canvas.
// ============================================================================

import type { Coordinate } from '../types/index';
import type { OverpassElement } from '../services/routeEnrichmentService';

export interface Polygon {
  outer: Coordinate[];
  /** Holes. In a water polygon these are islands. */
  inner: Coordinate[][];
}

export interface MaskFeature {
  /** `way/123` or `relation/456`, so a result can be traced back to OSM. */
  id: string;
  name?: string;
  tags: Record<string, string>;
  polygons: Polygon[];
}

export interface WaterMask {
  water: MaskFeature[];
  /** Mapped land inside water: islands, rocks, piers (D17). */
  land: MaskFeature[];
}

export type PointClass =
  | { kind: 'water'; feature: MaskFeature }
  | { kind: 'land'; island?: MaskFeature }
  | { kind: 'unknown' };

const WATER_AREA_TAGS: ReadonlyArray<readonly [string, ReadonlyArray<string>]> = [
  ['natural', ['water', 'bay', 'strait']],
  ['waterway', ['riverbank', 'dock', 'boatyard']],
  ['landuse', ['reservoir', 'basin']],
];

const LAND_IN_WATER_TAGS: ReadonlyArray<readonly [string, ReadonlyArray<string>]> = [
  ['place', ['island', 'islet']],
  ['natural', ['bare_rock', 'shoal']],
  ['man_made', ['pier', 'breakwater', 'groyne']],
];

const matches = (
  table: ReadonlyArray<readonly [string, ReadonlyArray<string>]>,
  tags: Record<string, string>,
) => table.some(([key, values]) => values.includes(tags[key]));

/** D16 (b): lakes, river areas, reservoirs, basins, bays, straits and docks. */
export const isWaterArea = (tags: Record<string, string> = {}): boolean =>
  matches(WATER_AREA_TAGS, tags);

/** D17 (b): islands, rocks and shoals, plus piers and breakwaters mapped as areas. */
export const isLandInWaterArea = (tags: Record<string, string> = {}): boolean =>
  matches(LAND_IN_WATER_TAGS, tags);

/** Even-odd ray cast in lat/lng; exact enough for containment at course scale. */
export const pointInRing = (point: Coordinate, ring: Coordinate[]): boolean => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    const crosses =
      a.lat > point.lat !== b.lat > point.lat &&
      point.lng < ((b.lng - a.lng) * (point.lat - a.lat)) / (b.lat - a.lat) + a.lng;
    if (crosses) inside = !inside;
  }
  return inside;
};

export const pointInPolygon = (point: Coordinate, polygon: Polygon): boolean =>
  pointInRing(point, polygon.outer) && !polygon.inner.some((hole) => pointInRing(point, hole));

const sameVertex = (a: Coordinate, b: Coordinate) => a.lat === b.lat && a.lng === b.lng;

const isClosed = (ring: Coordinate[]) => ring.length >= 4 && sameVertex(ring[0], ring[ring.length - 1]);

/**
 * Join way segments end to end into closed rings. A large lake's outline is
 * usually several ways; each may run either way round. A chain that never
 * closes is dropped: it has no inside to test against.
 */
export const joinIntoRings = (segments: Coordinate[][]): Coordinate[][] => {
  const pending = segments.filter((segment) => segment.length >= 2).map((segment) => [...segment]);
  const rings: Coordinate[][] = [];

  while (pending.length > 0) {
    const chain = pending.shift()!;
    let grew = true;
    while (!isClosed(chain) && grew) {
      grew = false;
      const end = chain[chain.length - 1];
      const index = pending.findIndex(
        (segment) => sameVertex(segment[0], end) || sameVertex(segment[segment.length - 1], end),
      );
      if (index === -1) break;
      const [next] = pending.splice(index, 1);
      const oriented = sameVertex(next[0], end) ? next : [...next].reverse();
      chain.push(...oriented.slice(1));
      grew = true;
    }
    if (isClosed(chain)) rings.push(chain);
  }

  return rings;
};

const toCoordinates = (geometry: { lat: number; lon: number }[] = []): Coordinate[] =>
  geometry
    .filter((point) => Number.isFinite(point?.lat) && Number.isFinite(point?.lon))
    .map((point) => ({ lat: point.lat, lng: point.lon }));

/**
 * D17 (c): an island mapped only as a point has no shape, so it is drawn as a
 * disc. Sizes are typical rather than measured: an islet is a rock or a tuft
 * of reeds, an island a wooded eyot.
 */
export const ISLET_NODE_RADIUS_METERS = 10;
export const ISLAND_NODE_RADIUS_METERS = 50;

const METRES_PER_DEGREE = 111_320;
const DISC_VERTICES = 16;

const discAround = (centre: Coordinate, radiusMeters: number): Coordinate[] => {
  const latRadius = radiusMeters / METRES_PER_DEGREE;
  const lngRadius = latRadius / Math.cos((centre.lat * Math.PI) / 180);
  const ring = Array.from({ length: DISC_VERTICES }, (_, index) => {
    const angle = (index / DISC_VERTICES) * Math.PI * 2;
    return { lat: centre.lat + latRadius * Math.sin(angle), lng: centre.lng + lngRadius * Math.cos(angle) };
  });
  return [...ring, ring[0]];
};

const NODE_RADIUS: Record<string, number> = {
  islet: ISLET_NODE_RADIUS_METERS,
  island: ISLAND_NODE_RADIUS_METERS,
};

/** The polygons an element describes: a closed way, a multipolygon's rings, or an island node's disc. */
export const polygonsFromElement = (element: OverpassElement): Polygon[] => {
  if (element.type === 'node') {
    const radius = NODE_RADIUS[element.tags?.place ?? ''];
    return radius && Number.isFinite(element.lat) && Number.isFinite(element.lon)
      ? [{ outer: discAround({ lat: element.lat!, lng: element.lon! }, radius), inner: [] }]
      : [];
  }

  if (element.type === 'way') {
    const ring = toCoordinates(element.geometry);
    return isClosed(ring) ? [{ outer: ring, inner: [] }] : [];
  }

  if (element.type !== 'relation') return [];

  const ringsFor = (role: string) =>
    joinIntoRings(
      (element.members ?? [])
        .filter((member) => member.type === 'way' && member.role === role)
        .map((member) => toCoordinates(member.geometry)),
    );

  const polygons: Polygon[] = ringsFor('outer').map((outer) => ({ outer, inner: [] }));
  for (const hole of ringsFor('inner')) {
    polygons.find((polygon) => pointInRing(hole[0], polygon.outer))?.inner.push(hole);
  }
  return polygons;
};

const toFeature = (element: OverpassElement): MaskFeature | null => {
  const polygons = polygonsFromElement(element);
  if (polygons.length === 0) return null;
  const tags = element.tags ?? {};
  return { id: `${element.type}/${element.id}`, name: tags.name, tags, polygons };
};

const byId = (a: MaskFeature, b: MaskFeature) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

const featuresWhere = (elements: OverpassElement[], keep: (tags: Record<string, string>) => boolean) =>
  elements
    .filter((element) => keep(element.tags ?? {}))
    .map(toFeature)
    .filter((feature): feature is MaskFeature => feature !== null)
    // Sorted so a result never depends on the order Overpass returned things in (G4).
    .sort(byId);

// ----------------------------------------------------------------------------
// The sea (D16 c, FR19). OSM has no sea polygon: it draws `natural=coastline`
// ways with the land on their left. Inside the query box, the sea is the area
// to the right of the coastline, closed off along the box edge.
// ----------------------------------------------------------------------------

export interface MaskBounds {
  minLat: number;
  minLng: number;
  maxLat: number;
  maxLng: number;
}

/** Join coastline ways head to tail. Never reversed: the direction says which side is land. */
const joinDirected = (segments: Coordinate[][]): Coordinate[][] => {
  const chains = segments.filter((segment) => segment.length >= 2).map((segment) => [...segment]);
  let joined = true;
  while (joined) {
    joined = false;
    for (const chain of chains) {
      if (isClosed(chain)) continue;
      const next = chains.find((other) => other !== chain && sameVertex(other[0], chain[chain.length - 1]));
      if (next) {
        chain.push(...next.slice(1));
        chains.splice(chains.indexOf(next), 1);
        joined = true;
        break;
      }
    }
  }
  return chains;
};

/** Twice the signed area in lng/lat: positive when the ring runs anticlockwise. */
const signedArea = (ring: Coordinate[]) =>
  ring.slice(1).reduce((sum, b, index) => sum + ring[index].lng * b.lat - b.lng * ring[index].lat, 0);

const inside = (point: Coordinate, box: MaskBounds) =>
  point.lat > box.minLat && point.lat < box.maxLat && point.lng > box.minLng && point.lng < box.maxLng;

/** Liang–Barsky: the part of segment a→b inside the box, as fractions along it. */
const clipSegment = (a: Coordinate, b: Coordinate, box: MaskBounds): [number, number] | null => {
  const dx = b.lng - a.lng;
  const dy = b.lat - a.lat;
  let t0 = 0;
  let t1 = 1;
  const edges: Array<[number, number]> = [
    [-dx, a.lng - box.minLng],
    [dx, box.maxLng - a.lng],
    [-dy, a.lat - box.minLat],
    [dy, box.maxLat - a.lat],
  ];
  for (const [p, q] of edges) {
    if (p === 0) {
      if (q < 0) return null;
      continue;
    }
    const r = q / p;
    if (p < 0) t0 = Math.max(t0, r);
    else t1 = Math.min(t1, r);
    if (t0 > t1) return null;
  }
  return [t0, t1];
};

const lerp = (a: Coordinate, b: Coordinate, t: number): Coordinate => ({
  lat: a.lat + (b.lat - a.lat) * t,
  lng: a.lng + (b.lng - a.lng) * t,
});

/** Pieces of a chain inside the box, each entering and leaving through the edge; `null` if one ends inside. */
const piecesInside = (chain: Coordinate[], box: MaskBounds): Coordinate[][] | null => {
  if (inside(chain[0], box) || inside(chain[chain.length - 1], box)) return null;
  const pieces: Coordinate[][] = [];
  let current: Coordinate[] | null = null;
  for (let index = 1; index < chain.length; index++) {
    const a = chain[index - 1];
    const b = chain[index];
    const clip = clipSegment(a, b, box);
    if (!clip) continue;
    const [t0, t1] = clip;
    if (!current) current = [lerp(a, b, t0)];
    current.push(lerp(a, b, t1));
    if (t1 < 1) {
      pieces.push(current);
      current = null;
    }
  }
  return pieces;
};

/** Position on the box edge, clockwise from the north-west corner, in [0, 4). */
const perimeterPosition = (point: Coordinate, box: MaskBounds): number => {
  const width = box.maxLng - box.minLng;
  const height = box.maxLat - box.minLat;
  const distances = [
    Math.abs(point.lat - box.maxLat),
    Math.abs(point.lng - box.maxLng),
    Math.abs(point.lat - box.minLat),
    Math.abs(point.lng - box.minLng),
  ];
  const edge = distances.indexOf(Math.min(...distances));
  const along = [
    (point.lng - box.minLng) / width,
    (box.maxLat - point.lat) / height,
    (box.maxLng - point.lng) / width,
    (point.lat - box.minLat) / height,
  ][edge];
  return (edge + Math.min(Math.max(along, 0), 0.999999)) % 4;
};

const cornersOf = (box: MaskBounds): Coordinate[] => [
  { lat: box.maxLat, lng: box.minLng },
  { lat: box.maxLat, lng: box.maxLng },
  { lat: box.minLat, lng: box.maxLng },
  { lat: box.minLat, lng: box.minLng },
];

const clockwiseGap = (from: number, to: number) => (to - from + 4) % 4 || 4;

/**
 * Close the coastline pieces into sea polygons. Walking a piece keeps the sea
 * on the right, so at its exit the sea continues clockwise along the box edge
 * to the next piece's entry, and so on round to the start.
 */
const seaRings = (pieces: Coordinate[][], box: MaskBounds): Coordinate[][] => {
  const corners = cornersOf(box);
  const unused = pieces.map((points) => ({
    points,
    entry: perimeterPosition(points[0], box),
    exit: perimeterPosition(points[points.length - 1], box),
  }));
  const rings: Coordinate[][] = [];

  while (unused.length > 0) {
    const start = unused.shift()!;
    const ring = [...start.points];
    let exit = start.exit;
    for (;;) {
      const candidates = [start, ...unused];
      const next = candidates.reduce((best, piece) =>
        clockwiseGap(exit, piece.entry) < clockwiseGap(exit, best.entry) ? piece : best,
      );
      const gap = clockwiseGap(exit, next.entry);
      for (let corner = Math.floor(exit) + 1; corner <= exit + gap; corner++) {
        if (corner < exit + gap) ring.push(corners[corner % 4]);
      }
      if (next === start) break;
      ring.push(...next.points);
      exit = next.exit;
      unused.splice(unused.indexOf(next), 1);
    }
    ring.push(ring[0]);
    rings.push(ring);
  }
  return rings;
};

const coastlineFeatures = (elements: OverpassElement[], box: MaskBounds | undefined): WaterMask => {
  const coastWays = elements.filter((element) => element.type === 'way' && element.tags?.natural === 'coastline');
  if (!box || coastWays.length === 0) return { water: [], land: [] };

  const chains = joinDirected(coastWays.map((element) => toCoordinates(element.geometry)));
  const islands = chains.filter((chain) => isClosed(chain) && signedArea(chain) > 0);
  const open = chains.filter((chain) => !isClosed(chain));
  const pieces = open.map((chain) => piecesInside(chain, box));
  if (pieces.some((piece) => piece === null)) return { water: [], land: [] };

  const flat = pieces.flat() as Coordinate[][];
  const boxCorners = cornersOf(box);
  const sea = flat.length > 0 ? seaRings(flat, box) : islands.length > 0 ? [[...boxCorners, boxCorners[0]]] : [];
  const tags = { natural: 'coastline' };
  return {
    water: sea.map((outer, index) => ({ id: `coastline/sea${index}`, name: 'Sea', tags, polygons: [{ outer, inner: [] }] })),
    land: islands.map((outer, index) => ({ id: `coastline/island${index}`, tags, polygons: [{ outer, inner: [] }] })),
  };
};

export interface WaterMaskOptions {
  /** The query box, needed to close the sea along its edge. No bounds, no sea. */
  coastlineBounds?: MaskBounds;
}

export const buildWaterMask = (elements: OverpassElement[], options: WaterMaskOptions = {}): WaterMask => {
  const coast = coastlineFeatures(elements, options.coastlineBounds);
  return {
    water: [...featuresWhere(elements, isWaterArea), ...coast.water].sort(byId),
    land: [...featuresWhere(elements, isLandInWaterArea), ...coast.land].sort(byId),
  };
};

const contains = (feature: MaskFeature, point: Coordinate) =>
  feature.polygons.some((polygon) => pointInPolygon(point, polygon));

/**
 * Water, land or unknown at a point. Mapped land inside water wins over the
 * water around it; a hole in a water polygon is land; with water mapped
 * nearby, anywhere outside it is land. With no water mapped at all OSM has
 * nothing to say, which is not the same as "land".
 */
export const classifyPoint = (mask: WaterMask, point: Coordinate): PointClass => {
  if (mask.water.length === 0) return { kind: 'unknown' };
  const island = mask.land.find((feature) => contains(feature, point));
  if (island) return { kind: 'land', island };
  const feature = mask.water.find((candidate) => contains(candidate, point));
  return feature ? { kind: 'water', feature } : { kind: 'land' };
};
