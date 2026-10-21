// ============================================================================
// SHELL ↔ ENGINE RENDER-STATS SEAM (#542 P1)
//
// The React debug panel read the scene's per-frame cost from
// `src/components/rower3d/{sceneStats,glContext}.ts`, which belong to the R3F
// scene tree the Svelte shell must not reach into (AC3). This is the read side
// the panel needs, re-homed into the framework-free renderer layer:
//
//   - the `RenderStats` / `ContextState` shapes the panel renders,
//   - `readRenderStats()` / `readContextState()` for the panel to poll,
//   - the writers the renderer (or a test) calls to publish them.
//
// The new WebGPU engine keeps its own richer telemetry (`engine/telemetry.ts`,
// `Rower3DRenderStats`); it does not feed these yet. So `readRenderStats()`
// returns `null`, and the panel renders its "the 3D scene has not drawn a
// frame" branch until the engine wires its stats through here — the same seam
// pattern as `getFrame` for the boat/ghost. Keeping the exact React shapes
// means the panel's DOM stays byte-identical (AC2).
// ============================================================================

import type { GPUBackend, PerformanceMode } from '../../components/rower3d/constants';

/** How stale a sample has to be before the render loop counts as stopped. */
export const STALL_THRESHOLD_MS = 2000;

export interface RenderStatsContext {
  backend: GPUBackend;
  performanceMode: PerformanceMode;
  fps?: number;
  p95Ms?: number;
}

export interface RenderStats extends RenderStatsContext {
  /**
   * The renderer doing the drawing. `backend` is what the browser can supply;
   * this is what the engine is actually using, reported rather than assumed so
   * a panel never names a renderer nobody built (#232/#345).
   */
  drawing: 'webgl' | 'webgpu' | 'unknown';
  /** Draw calls issued for the previous frame, all passes included. */
  drawCalls: number;
  /** Triangles submitted for the previous frame. */
  triangles: number;
  /** When the sample was taken, for spotting a stalled render loop. */
  sampledAt: number;
}

let latest: RenderStats | null = null;

/** Publish the previous frame's cost. Called by the renderer once a frame. */
export const recordRenderStats = (stats: RenderStats): void => {
  latest = stats;
};

/** The most recent frame's cost, or null before the scene has drawn one. */
export const readRenderStats = (): RenderStats | null => latest;

/** Forget the last sample — for tests, and when the scene unmounts. */
export const clearRenderStats = (): void => {
  latest = null;
};

/* --------------------------------------------------------- context state --- */

export type PowerPreference = 'high-performance' | 'low-power' | 'default';

export interface ContextState {
  powerPreference: PowerPreference;
  antialias: boolean;
  /** Largest device pixel ratio the surface will draw at. */
  maxDpr?: number;
  /** True while the context is gone and the scene is not drawing. */
  lost: boolean;
  /** How many times it has been lost this session. */
  losses: number;
  lostReason?: string;
  fallbackReason?: string;
}

let state: ContextState | null = null;

export const recordContextCreated = (selection: {
  powerPreference: PowerPreference;
  antialias: boolean;
  maxDpr?: number;
  fallbackReason?: string;
}): void => {
  state = { ...selection, lost: false, losses: 0 };
};

export const recordContextLost = (reason?: string): void => {
  if (!state) return;
  state = { ...state, lost: true, losses: state.losses + 1, lostReason: reason };
};

export const recordContextRestored = (): void => {
  if (!state) return;
  state = { ...state, lost: false, lostReason: undefined };
};

export const readContextState = (): ContextState | null => state;

export const clearContextState = (): void => {
  state = null;
};

/* --------------------------------------------------------------- reading --- */

export interface RenderStatsReading {
  stats: RenderStats | null;
  /** True when the scene has drawn nothing recently — a stalled or dead loop. */
  stalled: boolean;
  /** How the graphics context was obtained, and whether it is still there. */
  context: ContextState | null;
}

/** Take a reading now: the latest stats, whether they are stale, and the context. */
export const readRenderStatsReading = (now: number = Date.now()): RenderStatsReading => {
  const stats = readRenderStats();
  return {
    stats,
    stalled: !!stats && now - stats.sampledAt > STALL_THRESHOLD_MS,
    context: readContextState(),
  };
};
