import { describe, it, expect } from 'vitest';
import {
  RENDER_BUDGET,
  overBudget,
  type RenderBudget,
} from '../components/rower3d/renderBudget';
import type { PerformanceMode } from '../components/rower3d/constants';

/**
 * Issue #342 — the budget is a gate, not a note.
 *
 * `recordRenderStats` has counted draw calls, triangles and frame time since
 * #232 and nothing has ever been a ceiling. VR-04, VR-13 and VR-18 all add GPU
 * work, and each needs a line it cannot cross without someone noticing.
 */

const TIERS: PerformanceMode[] = ['basic', 'medium', 'extra-high'];
const AXES: Array<keyof RenderBudget> = ['drawCalls', 'triangles', 'p95Ms'];

describe('RENDER_BUDGET', () => {
  it('has a budget for every tier', () => {
    for (const tier of TIERS) {
      expect(RENDER_BUDGET[tier], `no budget for ${tier}`).toBeDefined();
    }
  });

  it.each(AXES)('allows more %s at each step up the tiers', (axis) => {
    expect(RENDER_BUDGET.medium[axis]).toBeGreaterThan(RENDER_BUDGET.basic[axis]);
    expect(RENDER_BUDGET['extra-high'][axis]).toBeGreaterThan(RENDER_BUDGET.medium[axis]);
  });

  // The measurements the table was set from, on the demo route at twenty
  // seconds, outside test mode. A ceiling under the reading is not a ceiling;
  // it is a red build on a tree nobody changed, which this project has had
  // once already (#340).
  it.each([
    ['basic' as const, 346, 215_513],
    ['medium' as const, 296, 217_840],
    ['extra-high' as const, 187, 281_254],
  ])('leaves %s room above what the scene measured', (tier, drawCalls, triangles) => {
    expect(RENDER_BUDGET[tier].drawCalls).toBeGreaterThan(drawCalls);
    expect(RENDER_BUDGET[tier].triangles).toBeGreaterThan(triangles);
  });
});

describe('overBudget', () => {
  it('says nothing when a frame is inside its budget', () => {
    expect(overBudget('basic', { drawCalls: 100, triangles: 1_000, p95Ms: 8 })).toEqual([]);
  });

  it('names the axis that broke rather than answering yes or no', () => {
    expect(overBudget('basic', { drawCalls: RENDER_BUDGET.basic.drawCalls + 1 })).toEqual([
      'drawCalls',
    ]);
    expect(overBudget('basic', { triangles: RENDER_BUDGET.basic.triangles + 1 })).toEqual([
      'triangles',
    ]);
    expect(overBudget('basic', { p95Ms: RENDER_BUDGET.basic.p95Ms + 1 })).toEqual(['p95Ms']);
  });

  it('names every axis that broke, not just the first', () => {
    expect(
      overBudget('basic', {
        drawCalls: 10_000,
        triangles: 10_000_000,
        p95Ms: 500,
      }),
    ).toEqual(['drawCalls', 'triangles', 'p95Ms']);
  });

  it('lets a frame sit exactly on its budget', () => {
    expect(overBudget('medium', { ...RENDER_BUDGET.medium })).toEqual([]);
  });

  it('checks only what it was given', () => {
    // A caller on a software rasteriser leaves frame time out rather than
    // asserting a number that describes the rasteriser.
    expect(overBudget('basic', { drawCalls: 10 })).toEqual([]);
    expect(overBudget('basic', {})).toEqual([]);
  });

  it('measures each tier against its own budget', () => {
    const cost = { triangles: RENDER_BUDGET.basic.triangles + 1 };
    expect(overBudget('basic', cost)).toEqual(['triangles']);
    expect(overBudget('extra-high', cost), 'high was held to the low budget').toEqual([]);
  });

  describe('on a slower machine', () => {
    it('scales the frame-time ceiling', () => {
      const slow = { p95Ms: RENDER_BUDGET.basic.p95Ms * 10 };
      expect(overBudget('basic', slow)).toEqual(['p95Ms']);
      expect(overBudget('basic', slow, 12)).toEqual([]);
    });

    // Draw calls and triangles are what the scene asks for. They do not depend
    // on what is drawing it, so scaling them would scale away the measurement.
    it('leaves draw calls and triangles where they are', () => {
      const heavy = {
        drawCalls: RENDER_BUDGET.basic.drawCalls + 1,
        triangles: RENDER_BUDGET.basic.triangles + 1,
      };
      expect(overBudget('basic', heavy, 100)).toEqual(['drawCalls', 'triangles']);
    });
  });
});
