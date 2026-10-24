import { describe, it, expect } from 'vitest';
import { RENDER_BUDGET, overBudget } from '../lib/renderer/renderBudget';
import { ALL_PERFORMANCE_MODES } from '../components/rower3d/constants';

/**
 * The render budget re-homed into the framework-free renderer layer for #542
 * (`src/lib/renderer/renderBudget.ts`), so the Svelte debug panel reads it from
 * the shell rather than the React scene tree. The table itself is covered by
 * `renderBudget.test.ts`; this guards that the re-homed copy exports the same
 * contract the panel now depends on.
 */
describe('renderBudget (lib copy for #542)', () => {
  it('has a budget for every performance tier', () => {
    for (const mode of ALL_PERFORMANCE_MODES) {
      expect(RENDER_BUDGET[mode]).toBeTruthy();
    }
  });

  it('names nothing when every cost is under budget', () => {
    expect(overBudget('medium', { drawCalls: 10, triangles: 10, p95Ms: 1 })).toEqual([]);
  });

  it('names each breached axis, and only those', () => {
    const breached = overBudget('basic', {
      drawCalls: RENDER_BUDGET.basic.drawCalls + 1,
      triangles: 1,
      p95Ms: RENDER_BUDGET.basic.p95Ms + 1,
    });
    expect(breached).toContain('drawCalls');
    expect(breached).toContain('p95Ms');
    expect(breached).not.toContain('triangles');
  });

  it('ignores a cost that was not measured', () => {
    expect(overBudget('basic', {})).toEqual([]);
  });

  it('names the triangle count when it alone is over budget', () => {
    expect(overBudget('basic', { triangles: RENDER_BUDGET.basic.triangles + 1 })).toEqual([
      'triangles',
    ]);
  });

  it('scales only the frame-time ceiling by cpuScale', () => {
    const mode = 'high';
    const justOver = RENDER_BUDGET[mode].p95Ms * 2 + 1;
    expect(overBudget(mode, { p95Ms: justOver })).toContain('p95Ms');
    expect(overBudget(mode, { p95Ms: justOver }, 3)).not.toContain('p95Ms');
  });
});
