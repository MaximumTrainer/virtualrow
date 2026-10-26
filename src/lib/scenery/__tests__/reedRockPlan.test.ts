/**
 * Reed + rock placement parity (#591 follow-up). Ports the shape of
 * React's `vegetationComponents.tsx` layout (`REED_MAX`, `ROCK_MAX`, per-
 * profile density thinning) to the curve-based WebGPU scenery pipeline.
 */

import { describe, it, expect } from 'vitest';

import { vec3 } from '../../renderer/math/vec3';
import { RouteCurve } from '../../renderer/math/curve';
import {
  layoutReeds,
  layoutRocks,
  REED_SPECIES,
  REED_MAX,
  ROCK_SPECIES,
  ROCK_MAX,
} from '../reedRockPlan';

const straightCurve = (lengthMetres: number): RouteCurve =>
  new RouteCurve(
    [vec3(0, 0, 0), vec3(0, 0, -lengthMetres)],
    false,
  );

describe('layoutReeds / layoutRocks (#591-fu)', () => {
  it('returns empty when there is no curve', () => {
    expect(layoutReeds({ curve: null })).toEqual([]);
    expect(layoutRocks({ curve: null })).toEqual([]);
  });

  it('every reed carries species 3 and every rock carries species 4', () => {
    const curve = straightCurve(200);
    const reeds = layoutReeds({ curve });
    const rocks = layoutRocks({ curve });
    for (const r of reeds) expect(r.species).toBe(REED_SPECIES);
    for (const r of rocks) expect(r.species).toBe(ROCK_SPECIES);
  });

  it('stays under the React per-profile caps (REED_MAX, ROCK_MAX)', () => {
    const curve = straightCurve(200);
    expect(layoutReeds({ curve }).length).toBeLessThanOrEqual(REED_MAX);
    expect(layoutRocks({ curve }).length).toBeLessThanOrEqual(ROCK_MAX);
  });

  it('is deterministic — same curve + no enrichment yields the same positions each call', () => {
    const curve = straightCurve(200);
    const a = layoutReeds({ curve });
    const b = layoutReeds({ curve });
    expect(a.length).toBe(b.length);
    for (let i = 0; i < a.length; i += 1) {
      expect(a[i].position).toEqual(b[i].position);
      expect(a[i].progress).toBeCloseTo(b[i].progress, 10);
    }
  });

  it('places props on both banks (sign distribution covers positive and negative perp offsets)', () => {
    const curve = straightCurve(400);
    const reeds = layoutReeds({ curve });
    // The straight curve is along -z, so the perpendicular is ±x. With a
    // ~50/50 side roll the layout should land props on both sides.
    const left = reeds.filter((r) => r.position[0] < 0).length;
    const right = reeds.filter((r) => r.position[0] > 0).length;
    expect(left).toBeGreaterThan(0);
    expect(right).toBeGreaterThan(0);
  });

  it('places props outside the water edge (|x| ≥ waterHalfWidth + margin)', () => {
    const curve = straightCurve(200);
    // Fallback water half-width = 20/2 = 10 m, plus the scenery margin + the
    // inner band — so no prop should sit inside the river itself.
    for (const reed of layoutReeds({ curve })) {
      expect(Math.abs(reed.position[0])).toBeGreaterThan(10);
    }
  });
});
