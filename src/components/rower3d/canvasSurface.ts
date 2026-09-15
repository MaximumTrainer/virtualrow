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
export const QUALITY_TIERS: PerformanceMode[] = ['low', 'auto', 'high'];

export interface CanvasSurface {
  antialias: boolean;
  shadows: boolean;
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
  low: {
    antialias: false,
    shadows: false,
    shadowMapSize: 0,
    dpr: 1,
    powerPreference: 'low-power',
  },
  auto: {
    antialias: true,
    shadows: true,
    shadowMapSize: 1024,
    dpr: [1, 1.5],
    powerPreference: 'default',
  },
  high: {
    antialias: true,
    shadows: true,
    shadowMapSize: 2048,
    dpr: [1, 2],
    powerPreference: 'high-performance',
  },
};

export const canvasSurfaceFor = (mode: PerformanceMode): CanvasSurface =>
  SURFACE_BY_TIER[mode] ?? SURFACE_BY_TIER.auto;

/** The largest device pixel ratio a surface will draw at. */
export const maxDpr = (dpr: number | [number, number]): number =>
  Array.isArray(dpr) ? dpr[1] : dpr;
