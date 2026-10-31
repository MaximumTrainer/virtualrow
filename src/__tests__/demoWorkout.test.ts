import { describe, it, expect } from 'vitest';
import { demoIntervalWorkout, DEMO_ROUTE_ID, DEMO_WORKOUT_ID } from '../lib/data/demoWorkout';
import { willowbrookRiverCoordinates } from '../data/seedRouteCoordinates';
import { routeTotalDistanceMeters } from '../lib/utils/geoUtils';

describe('demoIntervalWorkout (#472 FR1)', () => {
  it('AC1: total prescribed distance matches the Willowbrook route within ±5 m', () => {
    const expected = routeTotalDistanceMeters(willowbrookRiverCoordinates);
    const got = demoIntervalWorkout.segments.reduce(
      (sum, seg) => sum + (seg.distance ?? 0),
      0,
    );
    expect(Math.abs(got - expected)).toBeLessThanOrEqual(5);
    expect(demoIntervalWorkout.totalDistance).toBe(Math.round(expected));
  });

  it('AC1/D5a: segment sequence is warmup → 4 × (T, rest) → cooldown', () => {
    expect(demoIntervalWorkout.segments.map((s) => s.type)).toEqual([
      'warmup',
      'interval', 'rest',
      'interval', 'rest',
      'interval', 'rest',
      'interval', 'rest',
      'cooldown',
    ]);
  });

  it('AC1/D5a: segment distance ratios preserve the 500 / 750 / 250 / 500 template', () => {
    const [warmup, firstWork, firstRest, , , , , , , cooldown] = demoIntervalWorkout.segments;
    expect(warmup.distance).toBe(cooldown.distance);
    expect(firstWork.distance ?? 0).toBeGreaterThan(firstRest.distance ?? 0);
    // Template ratio is 750 : 250 = 3 : 1.
    const workM = firstWork.distance ?? 0;
    const restM = firstRest.distance ?? 1;
    expect(workM / restM).toBeCloseTo(3, 1);
  });

  it('D6a: pace targets published, no power targets', () => {
    for (const seg of demoIntervalWorkout.segments) {
      expect(typeof seg.targetPaceMin).toBe('number');
      expect(typeof seg.targetPaceMax).toBe('number');
      expect(seg.targetPower).toBeUndefined();
    }
    expect(demoIntervalWorkout.targetMetric).toBe('pace');
  });

  it('T intervals are faster than UT2 recoveries (smaller seconds-per-500 m)', () => {
    const work = demoIntervalWorkout.segments.find((s) => s.type === 'interval');
    const rest = demoIntervalWorkout.segments.find((s) => s.type === 'rest');
    expect(work?.targetPaceMax ?? Infinity).toBeLessThan(rest?.targetPaceMin ?? -Infinity);
  });

  it('links to the demo route and uses a stable id', () => {
    expect(demoIntervalWorkout.routeId).toBe(DEMO_ROUTE_ID);
    expect(demoIntervalWorkout.id).toBe(DEMO_WORKOUT_ID);
    expect(DEMO_ROUTE_ID).toBe('1');
  });

  it('is marked as a manual, non-remote workout (FR7)', () => {
    expect(demoIntervalWorkout.source).toBe('manual');
  });
});
