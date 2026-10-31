import { describe, expect, it } from 'vitest';

import { angleDiff, boatRollRadians, routeCurvatureAt } from '../boatRoll';
import { RouteCurve } from '../../math/curve';
import { vec3 } from '../../math/vec3';

/**
 * Boat lean / heel into turns (#571). Pure maths — no GPU, no renderer.
 * The signs here lock in the "positive curvature → negative roll" rule the
 * placeBoat wiring depends on so the boat leans INTO the turn.
 */
describe('angleDiff', () => {
  it('is zero for identical angles', () => {
    expect(angleDiff(0, 0)).toBe(0);
    expect(angleDiff(1.2, 1.2)).toBeCloseTo(0, 10);
  });
  it('returns the shortest signed difference in (-π, π]', () => {
    expect(angleDiff(0, Math.PI / 4)).toBeCloseTo(Math.PI / 4, 10);
    expect(angleDiff(Math.PI / 4, 0)).toBeCloseTo(-Math.PI / 4, 10);
  });
  it('wraps across the ±π boundary rather than taking the long way round', () => {
    // From +170° to -170° is a +20° step (crossing ±π), not a -340° one.
    expect(angleDiff((170 * Math.PI) / 180, (-170 * Math.PI) / 180)).toBeCloseTo((20 * Math.PI) / 180, 10);
    expect(angleDiff((-170 * Math.PI) / 180, (170 * Math.PI) / 180)).toBeCloseTo((-20 * Math.PI) / 180, 10);
  });
});

describe('routeCurvatureAt', () => {
  it('is ~0 on a straight line', () => {
    // Four co-linear points along +Z.
    const curve = new RouteCurve([vec3(0, 0, 0), vec3(0, 0, 10), vec3(0, 0, 20), vec3(0, 0, 30)]);
    expect(Math.abs(routeCurvatureAt(curve, 0.5, 30))).toBeLessThan(1e-6);
  });

  it('is positive (counter-clockwise) on a left-hand bend', () => {
    // A gentle quarter-arc from (0, 0, 0) heading +Z to (10, 0, 10) heading
    // +X — counter-clockwise viewed from above.
    const curve = new RouteCurve([
      vec3(0, 0, 0),
      vec3(0, 0, 5),
      vec3(5, 0, 10),
      vec3(10, 0, 10),
    ]);
    const k = routeCurvatureAt(curve, 0.5, 20);
    expect(k).toBeGreaterThan(0);
  });

  it('flips sign on the mirrored right-hand bend', () => {
    // Mirror of the above — turning right (clockwise).
    const curve = new RouteCurve([
      vec3(0, 0, 0),
      vec3(0, 0, 5),
      vec3(-5, 0, 10),
      vec3(-10, 0, 10),
    ]);
    const k = routeCurvatureAt(curve, 0.5, 20);
    expect(k).toBeLessThan(0);
  });

  it('is zero when totalLengthMeters is zero (bail-out, no NaN)', () => {
    const curve = new RouteCurve([vec3(0, 0, 0), vec3(0, 0, 1), vec3(0, 0, 2), vec3(0, 0, 3)]);
    expect(routeCurvatureAt(curve, 0.5, 0)).toBe(0);
  });
});

describe('boatRollRadians', () => {
  it('is 0 on a straight route (curvature 0)', () => {
    expect(boatRollRadians(0)).toBe(0);
  });
  it('is NEGATIVE for positive (left) curvature — the boat heels into the left turn', () => {
    expect(boatRollRadians(0.05)).toBeLessThan(0);
  });
  it('is POSITIVE for negative (right) curvature — mirrored lean into a right turn', () => {
    expect(boatRollRadians(-0.05)).toBeGreaterThan(0);
  });
  it('asymptotes to ±maxRollRadians, never exceeds it', () => {
    const max = (8 * Math.PI) / 180;
    for (const k of [-10, -1, -0.5, 0.5, 1, 10, 1000]) {
      expect(Math.abs(boatRollRadians(k))).toBeLessThanOrEqual(max + 1e-9);
    }
    // Very large curvature saturates near the max.
    expect(Math.abs(boatRollRadians(100))).toBeCloseTo(max, 4);
  });
  it('is symmetric: f(-k) === -f(k)', () => {
    for (const k of [0.001, 0.01, 0.05, 0.3, 2]) {
      expect(boatRollRadians(k)).toBeCloseTo(-boatRollRadians(-k), 10);
    }
  });
  it('rejects non-finite curvature by returning 0 rather than NaN', () => {
    expect(boatRollRadians(Number.NaN)).toBe(0);
    expect(boatRollRadians(Number.POSITIVE_INFINITY)).toBe(0);
  });
});
