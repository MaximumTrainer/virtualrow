import { describe, it, expect } from 'vitest';
import {
  OAR_REACH_METERS,
  MIN_NAVIGABLE_WIDTH_METERS,
  navigableWaterWidthMeters,
} from '../components/rower3d/navigableWidth';

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
