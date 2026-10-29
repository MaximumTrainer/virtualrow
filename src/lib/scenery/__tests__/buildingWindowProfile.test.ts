import { describe, expect, it } from 'vitest';

import {
  WINDOW_PROFILES,
  WINDOW_PROFILE_COUNT,
  classifyWindowCell,
} from '../buildingWindowProfile';

/**
 * Per-palette window stripe contract (#567 follow-up). The shader
 * (`buildings.wgsl` fs_main) mirrors the same four profiles inline — a
 * drift here IS a drift there. Each profile asserts a handful of known
 * (perim, worldY) classifications so a change to spacing or pane size
 * is forced through this file.
 */
describe('classifyWindowCell per palette profile', () => {
  it('exposes exactly 4 profiles, one per palette index', () => {
    expect(WINDOW_PROFILE_COUNT).toBe(4);
    expect(WINDOW_PROFILES.length).toBe(WINDOW_PROFILE_COUNT);
  });

  it('clamps paletteIndex into [0, 3] rather than reading past the table', () => {
    // Index 42 behaves like the fallback (idx 3) and returns wall everywhere.
    expect(classifyWindowCell(42, 0, 3)).toBe('wall');
  });

  it('residential (0): a window centred near every (1.8 m, 3 m) cell above 1 m', () => {
    // Pane is 1.0 × 1.6 m centred in a 1.8 × 3.0 cell. One cell starts at
    // (perim = -0.9, worldY = 1.0): centre is at (perim 0, worldY 2.5),
    // half pane extent (0.5, 0.8).
    expect(classifyWindowCell(0, 0.0, 2.5)).toBe('glass');
    expect(classifyWindowCell(0, 0.49, 2.5)).toBe('glass'); // just inside pane
    expect(classifyWindowCell(0, 0.6, 2.5)).toBe('frame'); // between pane edge and outer frame
    expect(classifyWindowCell(0, 0.9, 2.5)).toBe('wall'); // past the frame → wall
    // Below the base course (y < 1.0) is always wall.
    expect(classifyWindowCell(0, 0.0, 0.5)).toBe('wall');
    // Next cell up — centre at worldY 5.5.
    expect(classifyWindowCell(0, 0.0, 5.5)).toBe('glass');
  });

  it('commercial (1): wider panes (1.4 m) on the same 1.8 × 3 cell', () => {
    // Pane 1.4 × 2.0 m → half extents (0.7, 1.0).
    expect(classifyWindowCell(1, 0.0, 2.5)).toBe('glass');
    expect(classifyWindowCell(1, 0.69, 2.5)).toBe('glass');
    expect(classifyWindowCell(1, 0.78, 2.5)).toBe('frame'); // 0.78 > 0.7 and <= 0.85
    // Narrower frame gap than residential — the pane fills more of each cell.
  });

  it('industrial (2): clerestory band only — windows between 6 m and 9 m', () => {
    // Pane 2.0 × 1.0 m, spacing 3.0 × 10 m, baseOffsetV 1.5 → single row of
    // panes centred at worldY = 7.5. Below the band → wall even at pane
    // coords.
    expect(classifyWindowCell(2, 0.0, 3.0)).toBe('wall'); // below band
    expect(classifyWindowCell(2, 0.0, 10.0)).toBe('wall'); // above band
    expect(classifyWindowCell(2, 0.0, 7.5)).toBe('glass');
    expect(classifyWindowCell(2, 0.99, 7.5)).toBe('glass');
    expect(classifyWindowCell(2, 1.1, 7.5)).toBe('frame'); // inside frame
    expect(classifyWindowCell(2, 1.3, 7.5)).toBe('wall'); // past the frame
  });

  it('fallback (3): never returns a window — the brick atlas alone paints the wall', () => {
    for (const perim of [-5, 0, 1.5, 3.7, 100]) {
      for (const worldY of [0.1, 1, 2, 5, 10, 50]) {
        expect(classifyWindowCell(3, perim, worldY)).toBe('wall');
      }
    }
  });

  it('is deterministic — the same (idx, perim, worldY) always returns the same cell', () => {
    for (const idx of [0, 1, 2]) {
      for (const p of [-3.2, 0, 1.1, 7.75]) {
        for (const y of [1.5, 4.2, 7.8]) {
          const a = classifyWindowCell(idx, p, y);
          const b = classifyWindowCell(idx, p, y);
          expect(a).toBe(b);
        }
      }
    }
  });

  it('is periodic along perim with each profile\'s spacingU', () => {
    // Shifting perim by one spacingU unit lands on the same cell. Use the
    // horizontal centreline of a pane row (worldY = minHeight + baseOffsetV)
    // so we're on a stable V band, and sample interior perim offsets that
    // sit well inside a glass / wall region (not on a frame edge).
    for (let idx = 0; idx < 3; idx += 1) {
      const p = WINDOW_PROFILES[idx]!;
      const y = p.minHeight + p.baseOffsetV;
      for (const perim of [0, 0.1, 0.3]) {
        expect(classifyWindowCell(idx, perim, y)).toBe(
          classifyWindowCell(idx, perim + p.spacingU, y),
        );
        expect(classifyWindowCell(idx, perim, y)).toBe(
          classifyWindowCell(idx, perim - 2 * p.spacingU, y),
        );
      }
    }
  });

  it('frame always surrounds glass — no cell goes glass → wall without frame between', () => {
    // Walk one cell outward from the pane centre; must see glass → frame →
    // wall. Each profile uses its own pane-centre worldY so industrial's
    // tight band still gets a valid centre.
    for (const idx of [0, 1, 2]) {
      const p = WINDOW_PROFILES[idx]!;
      const y = p.minHeight + p.baseOffsetV; // pane centre
      const samples: string[] = [];
      for (let perim = 0; perim <= p.spacingU * 0.5 + 0.01; perim += 0.05) {
        samples.push(classifyWindowCell(idx, perim, y));
      }
      const runs = samples.filter((s, i) => i === 0 || s !== samples[i - 1]);
      expect(runs[0]).toBe('glass');
      expect(runs[runs.length - 1]).toBe('wall');
      for (let i = 1; i < runs.length; i += 1) {
        if (runs[i - 1] === 'glass') expect(runs[i]).toBe('frame');
        if (runs[i - 1] === 'wall') expect(runs[i]).toBe('frame');
      }
    }
  });
});
