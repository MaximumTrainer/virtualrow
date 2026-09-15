// ============================================================================
// BRIDGE CROSSINGS — where a route passes under a bridge.
//
// Overpass is already queried for land use and waterways over the route's
// bounding box, so bridges arrive on the same request; this reads them out.
// Lives in utils because the enrichment service consumes it, and a service may
// depend on utils but never on a component (agents.md §4). The mapping from a
// crossing to a Tier C model is in components/rower3d/sceneryCrossings.ts.
// ============================================================================

import type { Coordinate } from '../types/index';
import type { OverpassElement } from '../services/routeEnrichmentService';
import { distanceBetweenLatLng } from './geoUtils';

export type BridgeKind =
  | 'arch'
  | 'road'
  | 'truss'
  | 'rail'
  | 'bascule'
  | 'foot'
  | 'lift'
  | 'cantilever';

/**
 * What kind of bridge OSM is describing.
 *
 * A movable deck is the most visible thing about a bridge, so it outranks the
 * structure; what the bridge carries decides the rest.
 */
export const bridgeKindFromTags = (tags: Record<string, string> = {}): BridgeKind => {
  const movable = tags['bridge:movable'];
  if (movable === 'bascule') return 'bascule';
  if (movable === 'lift' || movable === 'vertical-lift') return 'lift';

  const structure = tags['bridge:structure'];
  if (structure === 'arch') return 'arch';
  if (structure === 'truss') return 'truss';
  if (structure === 'cantilever') return 'cantilever';

  if (tags.railway) return 'rail';
  if (['footway', 'path', 'cycleway', 'pedestrian', 'steps'].includes(tags.highway ?? '')) {
    return 'foot';
  }
  return 'road';
};

export interface Crossing {
  /** Where along the route the bridge passes overhead, 0–1. */
  progress: number;
  kind: BridgeKind;
}

/** A bridge more than this far from the rowed line is over some other water. */
const MAX_CROSSING_METERS = 120;

/**
 * Tag values that mean "this is not a bridge", despite the key being present.
 *
 * `!tags.bridge` is false for the string "no", so an explicit denial used to
 * read as a crossing and put a Tier C model over water nothing spans
 * (review of #232).
 */
const NOT_A_BRIDGE = new Set(['no', 'false', '0']);

const isBridge = (tags: Record<string, string> | undefined): boolean => {
  const value = tags?.bridge;
  return typeof value === 'string' && value !== '' && !NOT_A_BRIDGE.has(value.toLowerCase());
};

/** Two crossings closer than this are the same structure seen twice. */
const MIN_SEPARATION = 0.01;

const centreOf = (element: OverpassElement): Coordinate | null => {
  const points = element.geometry ?? [];
  if (points.length === 0) return null;
  const lat = points.reduce((sum, p) => sum + p.lat, 0) / points.length;
  const lng = points.reduce((sum, p) => sum + p.lon, 0) / points.length;
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
};

/**
 * Degrees of latitude worth MAX_CROSSING_METERS, plus a margin.
 *
 * A degree of latitude is ~111 km everywhere; longitude shrinks with latitude,
 * so the longitude window is widened by 1/cos(lat) at the point being tested.
 */
const LAT_WINDOW = (MAX_CROSSING_METERS * 1.5) / 111_320;

/**
 * The route point a bridge sits over, with how far off it is.
 *
 * The cheap degree-delta test first is what keeps this affordable: the bbox
 * query returns on the order of a thousand bridge ways on an urban river, and
 * every one of them used to run a haversine against every route point on the
 * main thread (review of #232). Points outside the window cannot be within
 * MAX_CROSSING_METERS, so rejecting them costs two subtractions.
 */
const nearestPoint = (route: Coordinate[], centre: Coordinate) => {
  const lngWindow = LAT_WINDOW / Math.max(0.01, Math.cos((centre.lat * Math.PI) / 180));
  let best = { metres: Number.POSITIVE_INFINITY, index: 0 };

  for (let index = 0; index < route.length; index += 1) {
    const point = route[index];
    if (Math.abs(point.lat - centre.lat) > LAT_WINDOW) continue;
    if (Math.abs(point.lng - centre.lng) > lngWindow) continue;

    const metres = distanceBetweenLatLng(point.lat, point.lng, centre.lat, centre.lng);
    if (metres < best.metres) best = { metres, index };
  }

  return best;
};

/**
 * Whether the way actually crosses the rowed line, rather than merely passing
 * near it.
 *
 * A road on an embankment running parallel to the river has a centroid well
 * inside the 120 m window and spans nothing; the segments have to straddle the
 * line for it to be a crossing. Tested as a sign change of the cross product
 * about the nearest route heading, which needs no projection.
 */
const spansRoute = (route: Coordinate[], element: OverpassElement, index: number): boolean => {
  const points = element.geometry ?? [];
  if (points.length < 2) return false;

  const a = route[Math.max(0, index - 1)];
  const b = route[Math.min(route.length - 1, index + 1)];
  const hx = b.lng - a.lng;
  const hy = b.lat - a.lat;
  if (hx === 0 && hy === 0) return false;

  let sawLeft = false;
  let sawRight = false;
  for (const p of points) {
    const cross = hx * (p.lat - a.lat) - hy * (p.lon - a.lng);
    if (cross > 0) sawLeft = true;
    else if (cross < 0) sawRight = true;
    if (sawLeft && sawRight) return true;
  }
  return false;
};

/**
 * Bridges over this route, in route order.
 *
 * Overpass answers for the whole bounding box, which on a city river includes
 * crossings of other channels entirely — so a candidate has to pass close to
 * the rowed line to count.
 */
export const findCrossings = (
  coordinates: Coordinate[],
  elements: OverpassElement[],
): Crossing[] => {
  if (coordinates.length < 2) return [];

  const found: Crossing[] = [];
  for (const element of elements) {
    if (!isBridge(element.tags)) continue;
    const centre = centreOf(element);
    if (!centre) continue;

    const { metres, index } = nearestPoint(coordinates, centre);
    if (metres > MAX_CROSSING_METERS) continue;
    if (!spansRoute(coordinates, element, index)) continue;

    found.push({
      progress: index / (coordinates.length - 1),
      kind: bridgeKindFromTags(element.tags),
    });
  }

  // Compared against the last crossing *kept*, not the last one seen: a run of
  // near-neighbours used to collapse entirely, because each was measured
  // against the one before it rather than against the survivor (review of #232).
  const ordered = found.sort((a, b) => a.progress - b.progress);
  const kept: Crossing[] = [];
  for (const crossing of ordered) {
    const last = kept[kept.length - 1];
    if (!last || crossing.progress - last.progress > MIN_SEPARATION) kept.push(crossing);
  }
  return kept;
};
