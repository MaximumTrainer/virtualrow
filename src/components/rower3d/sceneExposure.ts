// ============================================================================
// HOW BRIGHT THE SCENE IS EXPOSED
//
// The scene config authors a sky exposure, and for a long time nothing read
// it. The canvas hardcoded `toneMappingExposure: 1.0`, and the
// only other writer lerped towards 1.0 as well.
//
// drei's <Sky> is a physically based atmosphere and outputs high dynamic range.
// Exposed at 1.0 it renders white, and the reflective water renders the white
// sky back: 79% of a captured frame came back near-white, with the channel
// indistinguishable from the bank (#269).
//
// The config already knew the answer. This reads it.
// ============================================================================

import { SCENE_CONFIG } from './themeConfig';

/** Speed above which the scene is exposed a little darker, for contrast. */
const FAST_MPS = 3;

/** How much darker at speed. Applied to the authored exposure, not to 1.0. */
const FAST_FACTOR = 0.85;

/**
 * Tone-mapping exposure at a given boat speed.
 *
 * Relative to what the config asked for, so the speed response does not
 * quietly re-brighten everything to 1.0.
 */
export const sceneExposure = (velocityMps: number): number => {
  const base = SCENE_CONFIG.sky.exposure;
  const speed = Number.isFinite(velocityMps) ? velocityMps : 0;
  return speed > FAST_MPS ? base * FAST_FACTOR : base;
};
