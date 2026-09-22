import type { PerformanceMode } from './constants';

// ============================================================================
// WHAT A FRAME IS ALLOWED TO COST (#342)
//
// `recordRenderStats` has counted draw calls, triangles and frame time since
// #232, and `route-performance-budgets.spec.ts` has read some of it — but
// nothing has ever been a ceiling. VR-04 (the water material), VR-13 and VR-18
// all add GPU work, and each needs a line it cannot cross without someone
// noticing.
//
// One table, read by the spec that gates a PR and by the debug panel a rower
// can open, so the number in the panel is the number CI holds.
//
// ## Where these came from
//
// Measured on the demo route at each tier, twenty seconds in, with the scene
// the rower actually gets — which is not the scene the old draw-call budget
// measured. That one read `window.__ROWER3D_RENDER_STATS`, published only
// under `IS_TEST_MODE`, and test mode drops the effect stack, the wake, the
// spray and the environment probe: it recorded 186 draw calls where the same
// route outside test mode recorded 1114. `isTelemetryPublished` separates the
// two so this table can describe the real thing.
//
//   low   346 draw calls   215,513 triangles
//   auto  296 draw calls   217,840 triangles
//   high  187 draw calls   281,254 triangles
//
// Draw calls do not order by tier there, and that is not a mystery worth
// encoding: on a software rasteriser the higher tiers are still building
// chunks twenty seconds in, so the count is a snapshot of a scene mid-load.
// Triangles do order by tier, which is the number that describes the scene
// rather than the machine. The ceilings are set above the highest reading on
// any tier, and rise with the tier so a change that costs more at `high` than
// at `low` is still caught.
// ============================================================================

export interface RenderBudget {
  /** Draw calls in a frame, all passes included. */
  drawCalls: number;
  /** Triangles submitted in a frame. */
  triangles: number;
  /**
   * 95th-percentile frame time, in milliseconds.
   *
   * Only meaningful on real hardware. A software rasteriser is one to two
   * orders of magnitude slower — the demo route measures a p50 of 750 ms at
   * `low` and 2,000 ms at `high` under SwiftShader — so a caller either scales
   * this or, better, leaves `p95Ms` out of what it checks.
   */
  p95Ms: number;
}

export const RENDER_BUDGET: Record<PerformanceMode, RenderBudget> = {
  low: { drawCalls: 450, triangles: 400_000, p95Ms: 20 },
  auto: { drawCalls: 550, triangles: 600_000, p95Ms: 24 },
  high: { drawCalls: 650, triangles: 900_000, p95Ms: 33 },
};

/** A frame's measured cost. Anything left out is not checked. */
export interface RenderCost {
  drawCalls?: number;
  triangles?: number;
  p95Ms?: number;
}

/**
 * Which of a frame's costs are over budget, named.
 *
 * Returns the keys rather than a boolean so a failure says what broke — a gate
 * that reports "over budget" and nothing else sends the next person to measure
 * it all again.
 *
 * `cpuScale` multiplies the frame-time ceiling only. Draw calls and triangles
 * are what the scene asks for and do not depend on what is drawing it, so
 * scaling them would be scaling away the measurement.
 */
export const overBudget = (
  mode: PerformanceMode,
  cost: RenderCost,
  cpuScale = 1,
): Array<keyof RenderCost> => {
  const budget = RENDER_BUDGET[mode];
  const breached: Array<keyof RenderCost> = [];

  if (cost.drawCalls !== undefined && cost.drawCalls > budget.drawCalls) {
    breached.push('drawCalls');
  }
  if (cost.triangles !== undefined && cost.triangles > budget.triangles) {
    breached.push('triangles');
  }
  if (cost.p95Ms !== undefined && cost.p95Ms > budget.p95Ms * cpuScale) {
    breached.push('p95Ms');
  }

  return breached;
};
