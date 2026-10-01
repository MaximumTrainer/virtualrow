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
    dpr: 1,
    powerPreference: 'low-power',
  },
  // medium = today's `auto`: AA + shadows + dpr up to 1.5, default adapter.
  medium: {
    antialias: true,
    shadows: true,
    softShadows: true,
    shadowMapSize: 1024,
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
    dpr: [1, 2],
    powerPreference: 'high-performance',
  },
};

export const canvasSurfaceFor = (mode: PerformanceMode): CanvasSurface =>
  SURFACE_BY_TIER[mode] ?? SURFACE_BY_TIER.medium;

/** The largest device pixel ratio a surface will draw at. */
export const maxDpr = (dpr: number | [number, number]): number =>
  Array.isArray(dpr) ? dpr[1] : dpr;
