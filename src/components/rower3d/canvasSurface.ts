// ============================================================================
// THE SURFACE EACH QUALITY TIER GETS
//
// These settings used to be inline booleans on the <Canvas>, all of them keyed
// off one `isHighQuality = performanceMode !== 'low'`. That left the middle
// tier — `auto`, which is what most machines resolve to — with a surface built
// for the top tier: multisampling, a 2048 shadow map, device pixel ratio 2 and
// a demand for the discrete adapter. On a hybrid laptop that demand is the one
// the driver refuses, and on integrated hardware it is 891 ms frames.
//
// One table instead, so a tier cannot quietly acquire a setting it has no
// business asking for, and so the correlations are testable in one place
// (issue #232).
// ============================================================================

import type { PerformanceMode } from './constants';
import type { PowerPreference } from './glContext';

/** Every tier the scene can run at, weakest first. */
export const QUALITY_TIERS: PerformanceMode[] = ['basic', 'low', 'medium', 'high', 'extra-high'];

export interface CanvasSurface {
  antialias: boolean;
  shadows: boolean;
  /**
   * Soft shadow edges (`PCFSoftShadowMap`) rather than three's default
   * `PCFShadowMap` (#352). At the resolutions this scene can afford the
   * default is a hard edge, and a scull's shadow on open water reads as a
   * cut-out. It costs a wider tap pattern and nothing else, so every tier that
   * draws shadows at all draws them soft.
   */
  softShadows: boolean;
  /** Shadow map edge in texels; 0 when the tier draws no shadows. */
  shadowMapSize: number;
  /**
   * Metres of route per bank-foliage chunk (#497). One `InstancedMesh` per
   * (species, chunk) pair, each with its own bounding sphere, so three's own
   * frustum test can skip whole chunks instead of the CPU scanning every tree
   * on the route. Smaller numbers = tighter spheres and more draw calls, so
   * weaker tiers get bigger chunks.
   */
  foliageChunkMetres: number;
  /**
   * Number of CSM cascades the tier uses for the sun's shadow (#495). `0`
   * means no shadows at all; `1` means today's single-shadow-map behaviour;
   * `≥ 2` enables three's `CSM` and splits the shadow volume into cascades
   * that keep per-cascade texels tight. The map size `shadowMapSize` is per
   * cascade (#495 D3-a — split, don't grow).
   */
  cascadeCount: number;
  /** R3F device-pixel-ratio setting: a fixed ratio, or a [min, max] range. */
  dpr: number | [number, number];
  powerPreference: PowerPreference;
}

/**
 * `auto` is the middle tier, not a synonym for high.
 *
 * It means "decide for me", and demanding the discrete GPU is a decision — the
 * one that opens no context at all on a hybrid laptop. So the middle keeps
 * shadows and multisampling but leaves the adapter to the browser and the
 * drawing buffer below retina.
 */
const SURFACE_BY_TIER: Record<PerformanceMode, CanvasSurface> = {
  // basic = the fallback that shipped as `low` before #455: no AA, no shadows,
  // dpr 1, low-power. Pixel-equal to today's low (FR10).
  basic: {
    antialias: false,
    shadows: false,
    softShadows: false,
    shadowMapSize: 0,
    // #497 D1-b: 200/400/800 for basic/medium+high/extra-high. Basic draws
    // nothing we'd save by chunking foliage, but keep the knob consistent so
    // the config shape doesn't need a `null` case.
    foliageChunkMetres: 200,
    cascadeCount: 0,
    dpr: 1,
    powerPreference: 'low-power',
  },
  // low = the new middle-low (#455 D1): shadows at a small map, still dpr 1
  // and still low-power so a weak-but-real GPU gets the depth of a shadow
  // without the bandwidth of 1.5x pixels.
  low: {
    antialias: false,
    shadows: true,
    softShadows: true,
    shadowMapSize: 512,
    foliageChunkMetres: 400,
    // #495 D1-a — `low` keeps today's single-shadow-map behaviour; CSM only
    // kicks in from `medium` up.
    cascadeCount: 1,
    dpr: 1,
    powerPreference: 'low-power',
  },
  // medium = today's `auto`: AA + shadows + dpr up to 1.5, default adapter.
  medium: {
    antialias: true,
    shadows: true,
    softShadows: true,
    shadowMapSize: 1024,
    foliageChunkMetres: 400,
    // #495 D1-a — 2 cascades on medium; D3-a — 1024 is per cascade, so the
    // total shadow-map budget is 2 × 1024 = 2 × today's single map.
    cascadeCount: 2,
    dpr: [1, 1.5],
    powerPreference: 'default',
  },
  // high = new upper-mid (#455 D1): everything medium has plus 2x dpr and a
  // 1536 shadow map, now on the high-performance adapter.
  high: {
    antialias: true,
    shadows: true,
    softShadows: true,
    shadowMapSize: 1536,
    foliageChunkMetres: 400,
    cascadeCount: 3,
    dpr: [1, 2],
    powerPreference: 'high-performance',
  },
  // extra-high = today's `high` (#455 FR10). Keeps 2048 shadow map so visual
  // baseline matches the pre-migration PNG for the top tier.
  'extra-high': {
    antialias: true,
    shadows: true,
    softShadows: true,
    shadowMapSize: 2048,
    // #497 D1-b: 800 m chunks at `extra-high` keep per-chunk tree counts up
    // where the shadow pass benefits from fewer draw calls, and the longer
    // view distance here means fewer chunks are off-camera anyway.
    foliageChunkMetres: 800,
    cascadeCount: 4,
    dpr: [1, 2],
    powerPreference: 'high-performance',
  },
};

export const canvasSurfaceFor = (mode: PerformanceMode): CanvasSurface =>
  SURFACE_BY_TIER[mode] ?? SURFACE_BY_TIER.medium;

/** The largest device pixel ratio a surface will draw at. */
export const maxDpr = (dpr: number | [number, number]): number =>
  Array.isArray(dpr) ? dpr[1] : dpr;

/**
 * Named predicates for the tier gates in `Rower3D.tsx` (#455 FR4).
 *
 * The scene has a handful of switches that read as "does this tier draw X at
 * all". Expressed inline, each one is a string equality against a tier name,
 * and a tier added or removed later has to be chased through every site. One
 * named predicate per gate instead, so a boundary moves by editing one line.
 *
 * The boundaries follow #455 D1: `basic` is the cost-floor that draws no
 * decoration, so everything meaningful starts at `low`; the ground-relief
 * mesh is `extra-high`-only (today's #353 behaviour kept on the top tier).
 */
export const drawsShadows = (mode: PerformanceMode): boolean =>
  canvasSurfaceFor(mode).shadows;
export const drawsScenery = (mode: PerformanceMode): boolean =>
  mode !== 'basic';
export const drawsPostStack = (mode: PerformanceMode): boolean =>
  mode !== 'basic';
export const drawsGroundCover = (mode: PerformanceMode): boolean =>
  mode !== 'basic';
export const drawsWaterReflection = (mode: PerformanceMode): boolean =>
  mode !== 'basic';
export const drawsCaustics = (mode: PerformanceMode): boolean =>
  mode !== 'basic';
/**
 * The sun sphere that `godRays` samples as its source occluder. Only the top
 * tier runs `godRays` (see `effectPlan.ts`), so the mesh is on only there.
 */
export const drawsSunMesh = (mode: PerformanceMode): boolean =>
  mode === 'extra-high';

/**
 * Density-field grass on the bank slopes (#496, D3-b). Off at `basic` and
 * `low` — these tiers draw no shadows (basic) or the smallest shadow map
 * (low), so a fragment-shader density sample on every bank pixel is a cost
 * they cannot afford — and on at `medium` and above.
 *
 * The predicate alone turns no shader on: `isShaderGrassEnabled` combines it
 * with the runtime flag `__VIRTUALROW_SHADER_GRASS`, which Phase 1 defaults
 * off so visual baselines don't move while the plumbing lands. Phase 2 flips
 * the default and removes the single-tuft `InstancedMesh` branch in
 * `vegetationComponents.tsx`.
 */
export const drawsShaderGrass = (mode: PerformanceMode): boolean =>
  mode === 'medium' || mode === 'high' || mode === 'extra-high';

/**
 * Whether the density-field grass is actually mounted on `mode`. The predicate
 * must be true AND the kill switch not set: Phase 2 flips `undefined` to on,
 * so only an explicit `window.__VIRTUALROW_SHADER_GRASS = false` reverts to
 * the retired single-tuft `InstancedMesh` path (mirrors #495's `__VIRTUALROW_CSM`).
 */
export const isShaderGrassEnabled = (mode: PerformanceMode): boolean =>
  drawsShaderGrass(mode) && window.__VIRTUALROW_SHADER_GRASS !== false;

/**
 * Whether this tier runs Cascaded Shadow Maps (#495).
 *
 * CSM only earns its code at `cascadeCount ≥ 2`: fewer cascades than that
 * and three's own single-map path already covers the case. The runtime flag
 * `window.__VIRTUALROW_CSM = false` reverts to the single-map path even on
 * tiers that would otherwise run CSM (#495 D2-a) — a kill switch for the
 * visual-baseline re-record flow and for debugging in Playwright.
 *
 * Phase 2 of #495 (this file now) flips the default: `undefined` reads as
 * on, and only an explicit `false` keeps the single-map path. The wrapper
 * in `CascadedShadows.tsx` walks the scene and calls `csm.setupMaterial` on
 * every shadow-receiving material (preserving each material's own
 * `onBeforeCompile` by chaining the two callbacks), so the bank, water and
 * other receivers all pick a cascade per fragment instead of summing them.
 */
export const isCsmEnabled = (mode: PerformanceMode): boolean => {
  if (canvasSurfaceFor(mode).cascadeCount < 2) return false;
  // Phase 2 default: `undefined` reads as on; only explicit `false` reverts.
  return window.__VIRTUALROW_CSM !== false;
};
