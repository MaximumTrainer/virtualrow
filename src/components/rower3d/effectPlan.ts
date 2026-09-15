// ============================================================================
// WHICH POST-PROCESSING EACH TIER RUNS
//
// The effect stack used to be three hand-written <EffectComposer> blocks chosen
// by if/else, ending on an unguarded `return` that held the second-heaviest
// stack — reachable by any mode that was not 'auto' and had no sun.
//
// The middle tier's block ran SSAO with the composer's normal pass, which is a
// full-resolution pass and the most expensive thing in the scene. A rower on
// integrated hardware could run 'low' (no composer) and 'high' (whose god-rays
// pass throws every frame and aborts before the work completes, see #233), but
// 'auto' — the one complete, working chain — hung the GPU and lost the context
// about a second in.
//
// So the stack is a table too, keyed by tier, with the same rule as the surface
// in canvasSurface.ts: no tier may run an effect the tier above it skips
// (issue #232).
// ============================================================================

import type { PerformanceMode } from './constants';

export const EFFECT_NAMES = [
  'bloom',
  'chromaticAberration',
  'hueSaturation',
  'brightnessContrast',
  'vignette',
  'toneMapping',
  'ssao',
  'depthOfField',
  'godRays',
] as const;

export type EffectName = (typeof EFFECT_NAMES)[number];

export interface EffectPlan {
  /** False when no composer is mounted at all. */
  composer: boolean;
  /** The composer's normal pass — only SSAO needs it, and it is not free. */
  normalPass: boolean;
  effects: EffectName[];
  /** SSAO sample count, when SSAO runs. */
  ssaoSamples?: number;
}

/** Colour and tone work: cheap, full-screen, and what makes the scene look composed. */
const GRADE: EffectName[] = [
  'bloom',
  'chromaticAberration',
  'hueSaturation',
  'brightnessContrast',
  'vignette',
  'toneMapping',
];

const EMPTY: EffectPlan = { composer: false, normalPass: false, effects: [] };

/**
 * The effects a tier runs.
 *
 * An unknown mode gets the lightest plan, not the heaviest — the old fallback
 * did the opposite, so anything unexpected landed on SSAO and depth of field.
 */
export const effectPlanFor = (
  mode: PerformanceMode,
  { hasSun }: { hasSun: boolean },
): EffectPlan => {
  if (mode === 'high') {
    return {
      composer: true,
      normalPass: true,
      effects: [...GRADE, 'ssao', 'depthOfField', ...(hasSun ? (['godRays'] as EffectName[]) : [])],
      ssaoSamples: 24,
    };
  }

  if (mode === 'auto') {
    return { composer: true, normalPass: false, effects: [...GRADE] };
  }

  return EMPTY;
};

/** A rough ordering of how much a plan costs, for keeping the tiers in order. */
export const effectCost = (plan: EffectPlan): number =>
  plan.effects.length +
  (plan.normalPass ? 5 : 0) +
  (plan.effects.includes('ssao') ? 5 : 0) +
  (plan.effects.includes('depthOfField') ? 3 : 0) +
  (plan.effects.includes('godRays') ? 3 : 0);
