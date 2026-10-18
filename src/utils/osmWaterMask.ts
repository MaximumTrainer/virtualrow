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

/** The polygons an element describes: a closed way, or a multipolygon's rings. */
export const polygonsFromElement = (element: OverpassElement): Polygon[] => {
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

export const buildWaterMask = (elements: OverpassElement[]): WaterMask => ({
  water: featuresWhere(elements, isWaterArea),
  land: featuresWhere(elements, isLandInWaterArea),
});

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
