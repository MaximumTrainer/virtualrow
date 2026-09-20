import { describe, it, expect } from 'vitest';
import {
  OAR_REACH_METERS,
  MIN_NAVIGABLE_WIDTH_METERS,
  navigableWaterWidthMeters,
  bladeClearanceMeters,
} from '../components/rower3d/navigableWidth';
import { SCENE_SCALE } from '../components/rower3d/constants';

/**
 * A rigged single sculls with its blades 2.78 m either side of the centreline —
 * 0.80 m from centre to the gate, 1.98 m from gate to blade tip, validated
 * against real dimensions in #245. Nothing compared that against the channel,
 * so a segment reporting a narrower waterway put the blades over land and
 * nothing noticed (#271).
 */
describe('navigableWaterWidthMeters', () => {
  it('leaves a wide river exactly as reported', () => {
    // A river at 55 m has room to spare; widening it would be inventing water.
    expect(navigableWaterWidthMeters(55)).toBe(55);
    expect(navigableWaterWidthMeters(15)).toBe(15);
  });

  it('widens a channel too narrow for the blades', () => {
    // 4 m of water against a 5.56 m span: the blades would be on the bank.
    expect(navigableWaterWidthMeters(4)).toBe(MIN_NAVIGABLE_WIDTH_METERS);
    expect(navigableWaterWidthMeters(0.5)).toBe(MIN_NAVIGABLE_WIDTH_METERS);
  });

  it('keeps the blades over water at the minimum it allows', () => {
    // The point of the floor: half the narrowest channel must still clear the
    // reach, with something left over.
    expect(MIN_NAVIGABLE_WIDTH_METERS / 2).toBeGreaterThan(OAR_REACH_METERS);
  });

  it('is never narrower than the span, whatever it is given', () => {
    for (const reported of [0, 0.1, 1, 3, 5, 5.55, 7, 12, 100]) {
      const width = navigableWaterWidthMeters(reported);
      expect(width / 2, `a ${reported} m channel left the blades on land`).toBeGreaterThan(
        OAR_REACH_METERS,
      );
    }
  });

  it('handles nonsense rather than producing it', () => {
    for (const bad of [Number.NaN, -10, Number.POSITIVE_INFINITY]) {
      const width = navigableWaterWidthMeters(bad);
      expect(Number.isFinite(width)).toBe(true);
      expect(width).toBeGreaterThanOrEqual(MIN_NAVIGABLE_WIDTH_METERS);
    }
  });

  it('states the reach it was built around', () => {
    // 0.80 gate offset + 1.98 outboard, from scripts/build_crew.py.
    expect(OAR_REACH_METERS).toBeCloseTo(2.78, 2);
  });
});

/**
 * The number the running scene publishes, so "the blades are over water" stops
 * being a claim about arithmetic and becomes one about the game a rower plays.
 *
 * `navigableWaterWidthMeters` proves the floor is correct. It cannot prove the
 * scene applies it — the water, both banks and the debug guides each read the
 * width separately, and #271's fourth acceptance point is about what the boat
 * looks like between the red edges, not about what a function returns.
 */
describe('bladeClearanceMeters', () => {
  it('measures the water left beyond the blade tip', () => {
    // A 20 m channel: 10 m of half-width against a 2.78 m reach.
    expect(bladeClearanceMeters(20 * SCENE_SCALE)).toBeCloseTo(10 - OAR_REACH_METERS, 5);
  });

  it('is zero when the blade tip is exactly on the waterline', () => {
    expect(bladeClearanceMeters(OAR_REACH_METERS * 2 * SCENE_SCALE)).toBeCloseTo(0, 5);
  });

  it('goes negative when the blades are over land', () => {
    // 3 m of water against a 5.56 m span — the fault #271 reported.
    expect(bladeClearanceMeters(3 * SCENE_SCALE)).toBeLessThan(0);
  });

  it('is positive for every width the floor can produce', () => {
    // The two are meant to compose: nothing navigableWaterWidthMeters returns
    // may leave the blades on the bank.
    for (const reported of [0, 0.5, 3, 5.55, 7, 20, 55]) {
      const width = navigableWaterWidthMeters(reported);
      expect(
        bladeClearanceMeters(width * SCENE_SCALE),
        `a ${reported} m channel left ${bladeClearanceMeters(width * SCENE_SCALE)} m of clearance`,
      ).toBeGreaterThan(0);
    }
  });

  it('does not report clearance it cannot measure', () => {
    // NaN in, NaN out. A clearance of 0 here would read as "exactly on the
    // waterline", which is a measurement, and this is the absence of one.
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(Number.isNaN(bladeClearanceMeters(bad))).toBe(true);
    }
  });

  it('calls a negative width what it is, rather than refusing it', () => {
    // A channel width below zero is a fault upstream, and the honest report of
    // it is a large negative clearance — not NaN, which would read as "not
    // measured" and let the E2E guard skip the sample.
    expect(bladeClearanceMeters(-1)).toBeLessThan(0);
    expect(Number.isFinite(bladeClearanceMeters(-1))).toBe(true);
  });
});
