// ============================================================================
// PER-FRAME RENDER COST (#224, #232).
//
// `sceneMemory.ts` answers "how much is resident", which was never the tight
// budget: a 20 km route dressed from the GLB kit holds about 1 MB of geometry
// against the 80 MB allowance. What actually costs a frame is draw calls, and
// nothing measured them — so "is the scene slow, and why" could only be
// answered by attaching a profiler by hand.
//
// The counters are read once a frame *before* the effect composer runs. three's
// `info.render` is reset at the start of every `render()` call, and the
// composer makes several per frame, so by the time a frame ends the counters
// describe its last fullscreen pass and nothing else. Taking the renderer off
// automatic reset and zeroing it here instead means the figure covers the whole
// previous frame — scene pass and effect passes together, which is what the
// frame actually costs.
// ============================================================================

import type { GPUBackend, PerformanceMode } from './constants';

/** The subset of `THREE.WebGLRenderer` this needs, so a stub satisfies it. */
export interface RenderStatsSource {
  info?: {
    autoReset?: boolean;
    render?: { calls?: number; triangles?: number };
    reset?: () => void;
  };
}

export interface RenderStatsContext {
  backend: GPUBackend;
  performanceMode: PerformanceMode;
  fps?: number;
  p95Ms?: number;
}

export interface RenderStats extends RenderStatsContext {
  /** Draw calls issued for the previous frame, all passes included. */
  drawCalls: number;
  /** Triangles submitted for the previous frame. */
  triangles: number;
  /** When the sample was taken, for spotting a stalled render loop. */
  sampledAt: number;
}

let latest: RenderStats | null = null;

/**
 * Sample the previous frame's cost and start counting the next one.
 *
 * Call once per frame before the composer renders.
 */
export const recordRenderStats = (
  renderer: RenderStatsSource,
  context: RenderStatsContext,
): void => {
  const info = renderer.info;
  const render = info?.render;
  if (!info || !render) return;

  // Manual reset: otherwise each pass wipes the previous pass's count and the
  // frame's total is lost.
  info.autoReset = false;

  latest = {
    ...context,
    drawCalls: render.calls ?? 0,
    triangles: render.triangles ?? 0,
    sampledAt: Date.now(),
  };

  if (typeof info.reset === 'function') info.reset();
  else {
    render.calls = 0;
    render.triangles = 0;
  }
};

/** The most recent frame's cost, or null before the scene has drawn one. */
export const readRenderStats = (): RenderStats | null => latest;

/** Forget the last sample — for tests, and when the scene unmounts. */
export const clearRenderStats = (): void => {
  latest = null;
};
