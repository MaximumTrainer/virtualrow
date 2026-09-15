// ============================================================================
// REGION RESOLUTION — which regional building kit a course should wear.
//
// The Tier D models are organised by region (d-gb-*, d-ce-*, d-it-*, d-nl-*,
// d-us-*) but nothing could select them: resolveSceneryModels had no geography
// argument, and RouteEnrichmentData carries elevation, land use and water but
// nothing locational (issue #232).
//
// Region is derived from the route's own coordinates rather than another
// network round-trip: the answer is already in the track, and a bounding box
// is deterministic, offline and free — which also makes it testable and safe
// for the E2E suite. Boxes are deliberately coarse; they decide which building
// kit dresses the bank, not where anyone is.
// ============================================================================

import type { Coordinate } from '../../types/index';

export type SceneryRegion = 'gb' | 'ce' | 'it' | 'nl' | 'us';

interface RegionBox {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

/**
 * One coarse box per region. Ordered most specific first: the Netherlands sits
 * inside any box wide enough to hold central Europe, so it has to be tested
 * before its neighbours.
 */
export const SCENERY_REGIONS: Record<SceneryRegion, RegionBox> = {
  nl: { minLat: 50.7, maxLat: 53.6, minLng: 3.3, maxLng: 7.2 },
  gb: { minLat: 49.8, maxLat: 60.9, minLng: -8.7, maxLng: 1.8 },
  it: { minLat: 36.6, maxLat: 47.1, minLng: 6.6, maxLng: 18.6 },
  ce: { minLat: 45.8, maxLat: 55.1, minLng: 5.8, maxLng: 24.2 },
  us: { minLat: 24.5, maxLat: 49.4, minLng: -125.0, maxLng: -66.9 },
};

/** Tested in declaration order, so a narrower region wins over a wider one. */
const REGION_ORDER: SceneryRegion[] = ['nl', 'gb', 'it', 'ce', 'us'];

const contains = (box: RegionBox, { lat, lng }: Coordinate): boolean =>
  lat >= box.minLat && lat <= box.maxLat && lng >= box.minLng && lng <= box.maxLng;

const isUsable = (c: Coordinate | undefined): c is Coordinate =>
  !!c && Number.isFinite(c.lat) && Number.isFinite(c.lng);

/**
 * The regional kit for a route, or null when its water is outside the models we
 * have — in which case the generic Tier F set dresses it as before.
 *
 * Sampled at the midpoint: a course that crosses a border spends most of its
 * length on one side, and the middle is a better witness than either end.
 */
export const resolveRegion = (coordinates?: Coordinate[] | null): SceneryRegion | null => {
  const usable = (coordinates ?? []).filter(isUsable);
  if (usable.length === 0) return null;

  const midpoint = usable[Math.floor(usable.length / 2)];
  return REGION_ORDER.find((region) => contains(SCENERY_REGIONS[region], midpoint)) ?? null;
};
