// ============================================================================
// Per-segment scenery lookups. Split out of bankComponents.tsx so that file
// exports components only and keeps working fast refresh.
// ============================================================================
import type {
  RouteEnrichmentData,
  SceneryProfile,
} from '../../services/routeEnrichmentService';
import { trackProfileAt, type SceneryTrack } from './sceneryTrack';

/**
 * Returns the scenery profile of the nearest segment for the given progress (0–1).
 *
 * An authored track wins over enrichment: a route that states its own
 * progression is describing itself better than a land-use query over its
 * coordinates can (issue #232).
 */
export const getSegmentSceneryProfile = (
  enrichment: RouteEnrichmentData | null | undefined,
  progress: number,
  track?: SceneryTrack | null,
): SceneryProfile => {
  if (track) return trackProfileAt(track, progress);
  const segmentProfiles = enrichment?.segmentProfiles;
  if (!segmentProfiles || segmentProfiles.length === 0) return 'fallback';
  const safeProgress = Number.isFinite(progress) ? progress : 0;
  const clampedProgress = Math.max(0, Math.min(1, safeProgress));
  const nearestIndex = Math.round(clampedProgress * (segmentProfiles.length - 1));
  return segmentProfiles[Math.min(nearestIndex, segmentProfiles.length - 1)].sceneryProfile;
};

/** Baseline building height in scene units; profile heightRange multiplies this value. */
export const BASE_BUILDING_HEIGHT = 12.5;
