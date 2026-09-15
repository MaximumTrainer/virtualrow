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

/** Two crossings closer than this are the same structure seen twice. */
const MIN_SEPARATION = 0.01;

const centreOf = (element: OverpassElement): Coordinate | null => {
  const points = element.geometry ?? [];
  if (points.length === 0) return null;
  const lat = points.reduce((sum, p) => sum + p.lat, 0) / points.length;
  const lng = points.reduce((sum, p) => sum + p.lon, 0) / points.length;
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
};

/** The route point a bridge sits over, with how far off it is. */
const nearestPoint = (route: Coordinate[], centre: Coordinate) =>
  route.reduce(
    (best, point, index) => {
      const metres = distanceBetweenLatLng(point.lat, point.lng, centre.lat, centre.lng);
      return metres < best.metres ? { metres, index } : best;
    },
    { metres: Number.POSITIVE_INFINITY, index: 0 },
  );

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
    if (!element.tags?.bridge) continue;
    const centre = centreOf(element);
    if (!centre) continue;

    const { metres, index } = nearestPoint(coordinates, centre);
    if (metres > MAX_CROSSING_METERS) continue;

    found.push({
      progress: index / (coordinates.length - 1),
      kind: bridgeKindFromTags(element.tags),
    });
  }

  return found
    .sort((a, b) => a.progress - b.progress)
    .filter((crossing, i, all) => i === 0 || crossing.progress - all[i - 1].progress > MIN_SEPARATION);
};
