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
  /** #570 D9: `basic` draws an empty cockpit (hull only, no crew). */
  drawCrew: boolean;
  /** #570 D7-c: crew only casts a shadow on medium+. */
  castCharacterShadows: boolean;
}

const CAPS: Record<PerformanceTier, BuildingTierCaps> = {
  basic: { drawBuildings: false, drawClouds: false, castBuildingShadows: false, drawCrew: false, castCharacterShadows: false },
  low: { drawBuildings: true, drawClouds: false, castBuildingShadows: false, drawCrew: true, castCharacterShadows: false },
  medium: { drawBuildings: true, drawClouds: true, castBuildingShadows: true, drawCrew: true, castCharacterShadows: true },
  high: { drawBuildings: true, drawClouds: true, castBuildingShadows: true, drawCrew: true, castCharacterShadows: true },
  'extra-high': { drawBuildings: true, drawClouds: true, castBuildingShadows: true, drawCrew: true, castCharacterShadows: true },
};

export const tierCapsFor = (tier: string | undefined): BuildingTierCaps => {
  if (tier && (KNOWN_TIERS as readonly string[]).includes(tier)) {
    return CAPS[tier as PerformanceTier];
  }
  return CAPS[DEFAULT_TIER];
};
