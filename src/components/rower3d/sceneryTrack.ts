// ============================================================================
// AUTHORED SCENERY TRACKS — a route's dressing written down as data.
//
// Enrichment reads real geography from Overpass and OpenTopoData, which is the
// right source for a real course. The bundled demo route is not a real course:
// its description promises five distinct stretches, its coordinates sit over
// Munich, and its five sections lived only as comments in
// seedRouteCoordinates.ts — so it rendered either Munich's land use or, with no
// enrichment at all, one uniform `fallback` profile for the whole 5 km.
//
// A track states the progression instead, and feeds the same selection matrix
// every real route uses (issue #232).
// ============================================================================

import type {
  SceneryProfile,
  WaterBodyType,
} from '../../services/routeEnrichmentService';

export interface SceneryBand {
  /** Upper bound of the band as a fraction of route length; the last band ends at 1. */
  untilProgress: number;
  profile: SceneryProfile;
  water: WaterBodyType;
  /** Human label, matching the section names in seedRouteCoordinates.ts. */
  label: string;
}

export interface SceneryTrack {
  bands: SceneryBand[];
}

/** The bundled demo route, seeded by routeService. */
export const WILLOWBROOK_ROUTE_ID = '1';

/**
 * Willowbrook River, as its own description advertises it: forested highlands,
 * open meadows, rocky narrows, village waterfront, lake delta — five equal
 * kilometres of a 5 km route.
 */
export const WILLOWBROOK_SCENERY_TRACK: SceneryTrack = {
  bands: [
    { untilProgress: 0.2, profile: 'forest', water: 'stream', label: 'Forest headwaters' },
    { untilProgress: 0.4, profile: 'farmland', water: 'river', label: 'Open meadows' },
    { untilProgress: 0.6, profile: 'forest', water: 'river', label: 'Rocky narrows' },
    { untilProgress: 0.8, profile: 'residential', water: 'river', label: 'Village waterfront' },
    { untilProgress: 1, profile: 'wetland', water: 'lake', label: 'Lake delta' },
  ],
};

/** The authored track for a route, or null when its dressing comes from enrichment. */
export const getRouteSceneryTrack = (routeId?: string | null): SceneryTrack | null =>
  routeId === WILLOWBROOK_ROUTE_ID ? WILLOWBROOK_SCENERY_TRACK : null;

const bandAt = (track: SceneryTrack, progress: number): SceneryBand => {
  const safe = Number.isFinite(progress) ? Math.max(0, Math.min(1, progress)) : 0;
  return track.bands.find((band) => safe < band.untilProgress) ?? track.bands[track.bands.length - 1];
};

/** The authored scenery profile at a point along the route. */
export const trackProfileAt = (track: SceneryTrack, progress: number): SceneryProfile =>
  bandAt(track, progress).profile;

/** The authored water body at a point along the route — the delta opens into a lake. */
export const trackWaterAt = (track: SceneryTrack, progress: number): WaterBodyType =>
  bandAt(track, progress).water;

/** Each profile the track uses, once, for resolving one model set per profile. */
export const trackProfiles = (track: SceneryTrack): SceneryProfile[] => [
  ...new Set(track.bands.map((band) => band.profile)),
];

/**
 * The water a profile sits beside, so one route can resolve its delta against a
 * lake while the rest of it stays a river. Model sets are resolved once per
 * profile, so the first band wearing the profile decides.
 */
export const trackWaterForProfile = (
  track: SceneryTrack,
  profile: SceneryProfile,
): WaterBodyType => track.bands.find((band) => band.profile === profile)?.water ?? 'unknown';
