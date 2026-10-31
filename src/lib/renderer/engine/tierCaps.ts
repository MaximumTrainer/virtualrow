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
  /**
   * #591-fu P1c: the solid flora stage registers its pools with the depth
   * stage so near-camera trees cast shadows on the bank. Billboards/sprites
   * don't cast — their depth would carve rectangles into the atlas.
   */
  castFloraShadows: boolean;
  /**
   * #591-fu P1c: GLB kit scenery (kit trees, buildings, structures,
   * finish-line furniture) registers with the depth stage too, so a tall
   * ship or a bridge drops a real shadow onto the bank.
   */
  castSceneryShadows: boolean;
  /** #573 D8 — post-processing gates. Bloom/tone/vignette/LUT are universal;
   *  SSAO is high+ only; DOF is extra-high only (and off behind a flag). */
  drawBloom: boolean;
  drawVignette: boolean;
  drawLut: boolean;
  drawSsao: boolean;
  drawDof: boolean;
  /** #574 — auto-exposure (1×1 luminance render + composite divisor).
   *  On at `high` + `extra-high`; off below so a weaker GPU doesn't take
   *  the extra render pass per frame. */
  drawAutoExposure: boolean;
  /** #574 — subtle chromatic aberration in the composite pass: 3-tap radial
   *  colour-channel offset. Off below `high`; keep it below ~0.5% of the
   *  frame width so it reads as a lens feel, not a defect. */
  drawChromaticAberration: boolean;
  /** #574 — procedural rain overlay (screen-space streaks). Opt-in via
   *  `window.__VIRTUALROW_RAIN=true` even on tiers that allow it; the
   *  cap just says "the tier can afford the extra fullscreen draw".
   *  Off on `basic`; on from `low` upward. */
  drawRainOverlay: boolean;
}

const CAPS: Record<PerformanceTier, BuildingTierCaps> = {
  basic: {
    drawBuildings: false,
    drawClouds: false,
    castBuildingShadows: false,
    drawCrew: false,
    castCharacterShadows: false,
    castFloraShadows: false,
    castSceneryShadows: false,
    drawBloom: true,
    drawVignette: true,
    drawLut: true,
    drawSsao: false,
    drawDof: false,
    drawAutoExposure: false,
    drawChromaticAberration: false,
    drawRainOverlay: false,
  },
  low: {
    drawBuildings: true,
    drawClouds: false,
    castBuildingShadows: false,
    drawCrew: true,
    castCharacterShadows: false,
    castFloraShadows: false,
    castSceneryShadows: false,
    drawBloom: true,
    drawVignette: true,
    drawLut: true,
    drawSsao: false,
    drawDof: false,
    drawAutoExposure: false,
    drawChromaticAberration: false,
    drawRainOverlay: true,
  },
  medium: {
    drawBuildings: true,
    drawClouds: true,
    castBuildingShadows: true,
    drawCrew: true,
    castCharacterShadows: true,
    castFloraShadows: true,
    castSceneryShadows: true,
    drawBloom: true,
    drawVignette: true,
    drawLut: true,
    drawSsao: false,
    drawDof: false,
    drawAutoExposure: false,
    drawChromaticAberration: false,
    drawRainOverlay: true,
  },
  high: {
    drawBuildings: true,
    drawClouds: true,
    castBuildingShadows: true,
    drawCrew: true,
    castCharacterShadows: true,
    castFloraShadows: true,
    castSceneryShadows: true,
    drawBloom: true,
    drawVignette: true,
    drawLut: true,
    drawSsao: true,
    drawDof: false,
    drawAutoExposure: true,
    drawChromaticAberration: true,
    drawRainOverlay: true,
  },
  'extra-high': {
    drawBuildings: true,
    drawClouds: true,
    castBuildingShadows: true,
    drawCrew: true,
    castCharacterShadows: true,
    castFloraShadows: true,
    castSceneryShadows: true,
    drawBloom: true,
    drawVignette: true,
    drawLut: true,
    drawSsao: true,
    drawDof: true,
    drawAutoExposure: true,
    drawChromaticAberration: true,
    drawRainOverlay: true,
  },
};

export const tierCapsFor = (tier: string | undefined): BuildingTierCaps => {
  if (tier && (KNOWN_TIERS as readonly string[]).includes(tier)) {
    return CAPS[tier as PerformanceTier];
  }
  return CAPS[DEFAULT_TIER];
};
