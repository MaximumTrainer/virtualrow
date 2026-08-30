/**
 * How a route's geometry provenance is presented (issue #194 R-10, R-11).
 *
 * The chip is driven by provenance, not by how many points a route happens to
 * have: a 35-gate course is still nothing but gates, and a 9-point attached
 * track is still a real path. A route built from a genuine track gets no chip
 * at all — there is nothing to warn about.
 */

import type { GeometrySource, WaterRoute } from '../types/index';
import { DISTANCE_DISCREPANCY_THRESHOLD } from '../services/routeService';

export interface GeometryProvenanceBadge {
  /** Text shown in the chip. */
  label: string;
  /** Longer explanation, shown as the chip's tooltip. */
  title: string;
  /** Modifier appended to the chip's class name. */
  modifier: string;
}

const BADGES: Record<GeometrySource, GeometryProvenanceBadge | null> = {
  track: null,
  'polygon-path': {
    label: 'traced',
    title: 'This course follows a path traced by whoever submitted it, checked against every gate.',
    modifier: 'traced',
  },
  'osm-derived': {
    label: 'path from map data',
    title: 'This course follows the waterway centreline from OpenStreetMap, checked against every gate.',
    modifier: 'osm',
  },
  'gate-chain': {
    label: 'gates only — straight lines',
    title:
      'This course is defined by its gates only, so the path between them is a straight line. '
      + 'Attach a track of the course to row its real shape.',
    modifier: 'outline',
  },
};

/** The chip for a geometry source, or `null` when none should be shown. */
export function geometryProvenanceBadge(source: GeometrySource | undefined): GeometryProvenanceBadge | null {
  return source ? BADGES[source] ?? null : null;
}

/**
 * The "rownative lists X km" note, when their figure differs enough from the
 * length we actually row to be worth showing. Returns `null` otherwise.
 */
export function externalDistanceNote(route: Pick<WaterRoute, 'distance' | 'externalDistanceMeters'>): string | null {
  const external = route.externalDistanceMeters;
  if (!external || !Number.isFinite(external) || external <= 0) return null;

  const difference = Math.abs(route.distance * 1000 - external) / external;
  if (difference <= DISTANCE_DISCREPANCY_THRESHOLD) return null;

  return `rownative lists ${(external / 1000).toFixed(2)} km`;
}

/** Route distance for display, in kilometres to two decimal places. */
export function formatRouteDistanceKm(distanceKm: number): string {
  return `${distanceKm.toFixed(2)} km`;
}
