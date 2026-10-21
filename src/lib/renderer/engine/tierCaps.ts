/**
 * Per-tier feature gates for #566 P6. Keeps the tier → "draw X?" decisions
 * in one spot so a smoke page or the ride view can ask the same question
 * without re-reading tier strings in multiple files.
 *
 * Gates recommended on #566 D8:
 *   - buildings:      drawn on `low` and up (`basic` skips).
 *   - clouds:         drawn on `medium` and up (`basic` + `low` skip).
 *   - buildings cast: shadow-cast on `medium` and up (so `basic` + `low`
 *                     still *receive* via `sampleShadow`).
 */

import { DEFAULT_TIER, KNOWN_TIERS, type PerformanceTier } from './shadowConfig';

export interface BuildingTierCaps {
  drawBuildings: boolean;
  drawClouds: boolean;
  castBuildingShadows: boolean;
}

const CAPS: Record<PerformanceTier, BuildingTierCaps> = {
  basic: { drawBuildings: false, drawClouds: false, castBuildingShadows: false },
  low: { drawBuildings: true, drawClouds: false, castBuildingShadows: false },
  medium: { drawBuildings: true, drawClouds: true, castBuildingShadows: true },
  high: { drawBuildings: true, drawClouds: true, castBuildingShadows: true },
  'extra-high': { drawBuildings: true, drawClouds: true, castBuildingShadows: true },
};

export const tierCapsFor = (tier: string | undefined): BuildingTierCaps => {
  if (tier && (KNOWN_TIERS as readonly string[]).includes(tier)) {
    return CAPS[tier as PerformanceTier];
  }
  return CAPS[DEFAULT_TIER];
};
