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

import type * as THREE from 'three';
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
  /**
   * Where ACES runs: on the renderer when there is no composer, in the
   * composer when there is.
   *
   * The renderer is built with ACESFilmicToneMapping and the composer ends on a
   * ToneMapping pass set to ACES as well, so wherever a composer was mounted
   * the frame was graded twice - crushing the mid-tones, and part of why
   * `sceneExposure` had to be dragged to 0.55 to stop the sky blowing out
   * (#269, #327). Deciding it here means the two cannot disagree.
   */
  toneMapOnRenderer: boolean;
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

const EMPTY: EffectPlan = {
  composer: false,
  normalPass: false,
  effects: [],
  toneMapOnRenderer: true,
};

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
      toneMapOnRenderer: false,
    };
  }

  if (mode === 'auto') {
    // No depth of field. At worldFocusDistance 10 and range 25, from a camera
    // six metres behind the boat, everything past about thirty-five metres was
    // bokeh - which since #321 made a unit a metre is the entire far bank,
    // permanently. It survives at high, where it is focused on the boat (#327).
    return { composer: true, normalPass: false, effects: [...GRADE], toneMapOnRenderer: false };
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

/**
 * The mesh the god-rays pass should use, or null for no pass.
 *
 * GodRaysEffect.update dereferences `this.lightSource.parent` on every frame,
 * so the pass must never be built without a live mesh. The caller used to
 * compute `mode === 'high' ? sunMeshRef : undefined` and the composer guarded
 * on `!!sunMeshRef` — both of which test the *ref object*, which useRef makes
 * truthy from the first render. The mesh lives on `.current`, and that is null
 * until it mounts and stays null forever in test mode, where the sun mesh is
 * never rendered. High mode therefore threw a TypeError every frame (#233).
 *
 * Taking the mesh itself, so there is no ref to be fooled by, is the whole fix.
 */
export const godRaysSun = (
  mode: PerformanceMode,
  sunMesh: THREE.Mesh | null | undefined,
): THREE.Mesh | null => (mode === 'high' && sunMesh ? sunMesh : null);
