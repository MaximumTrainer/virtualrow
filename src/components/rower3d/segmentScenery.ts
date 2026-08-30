// ============================================================================
// Per-segment scenery lookups. Split out of bankComponents.tsx so that file
// exports components only and keeps working fast refresh.
// ============================================================================
import type {
  RouteEnrichmentData,
  SceneryProfile,
} from '../../services/routeEnrichmentService';

/** Returns the scenery profile of the nearest segment for the given progress (0–1). */
export const getSegmentSceneryProfile = (
  enrichment: RouteEnrichmentData | null | undefined,
  progress: number,
): SceneryProfile => {
  const segmentProfiles = enrichment?.segmentProfiles;
  if (!segmentProfiles || segmentProfiles.length === 0) return 'fallback';
  const safeProgress = Number.isFinite(progress) ? progress : 0;
  const clampedProgress = Math.max(0, Math.min(1, safeProgress));
  const nearestIndex = Math.round(clampedProgress * (segmentProfiles.length - 1));
  return segmentProfiles[Math.min(nearestIndex, segmentProfiles.length - 1)].sceneryProfile;
};

/** Baseline building height in scene units; profile heightRange multiplies this value. */
export const BASE_BUILDING_HEIGHT = 12.5;
