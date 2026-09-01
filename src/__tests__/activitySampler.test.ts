import { describe, it, expect } from 'vitest';
import { WorkoutService } from '../services/workoutService';
import type { Coordinate, PM5Data } from '../types/index';

/** A straight 2 km run of coastline, so distance along it is easy to reason about. */
const ROUTE: Coordinate[] = [
  { lat: 51.5, lng: -0.9 },
  { lat: 51.5, lng: -0.8712 },
];

function row(svc: WorkoutService, seconds: number, metresPerSecond = 4, extra: Partial<PM5Data> = {}) {
  for (let t = 0; t <= seconds; t++) {
    svc.updateSessionWithPM5Data({
      distance: t * metresPerSecond,
      elapsedTime: t,
      pace: 125,
      power: 180,
      cadence: 24,
      ...extra,
    });
  }
}

describe('activity sampler (issue #221, R1)', () => {
  it('appends at most one sample per second while active (AC1.1)', () => {
    const svc = new WorkoutService();
    svc.startSession('r1', 'Route 1', undefined, 'pm5', true, false, ROUTE);

    // Four packets inside the same second — a real PM5 pushes at 4 Hz.
    for (const distance of [0, 1, 2, 3]) {
      svc.updateSessionWithPM5Data({ distance, elapsedTime: 0.2, pace: 125, power: 180, cadence: 24 });
    }
    svc.updateSessionWithPM5Data({ distance: 4, elapsedTime: 1.2, pace: 125, power: 180, cadence: 24 });

    const samples = svc.getCurrentSession()!.samples;
    expect(samples.map((s) => s.t)).toEqual([0, 1]);
  });

  it('carries what the rower reported (AC1.1)', () => {
    const svc = new WorkoutService();
    svc.startSession('r1', 'Route 1', undefined, 'pm5', true, false, ROUTE);
    svc.updateSessionWithPM5Data({
      distance: 0, elapsedTime: 0, pace: 118, power: 205, cadence: 26, heartRate: 142,
    });

    expect(svc.getCurrentSession()!.samples[0]).toMatchObject({
      t: 0, distance: 0, pace: 118, power: 205, cadence: 26, heartRate: 142,
    });
  });

  it('records nothing while paused and keeps t monotonic across the gap (AC1.2)', () => {
    const svc = new WorkoutService();
    svc.startSession('r1', 'Route 1', undefined, 'pm5', true, false, ROUTE);
    row(svc, 2);

    svc.pauseSession();
    row(svc, 8);
    expect(svc.getCurrentSession()!.samples.map((s) => s.t)).toEqual([0, 1, 2]);

    svc.resumeSession();
    svc.updateSessionWithPM5Data({ distance: 40, elapsedTime: 10, pace: 125, power: 180, cadence: 24 });

    const ts = svc.getCurrentSession()!.samples.map((s) => s.t);
    expect(ts).toEqual([0, 1, 2, 10]);
    expect(ts.every((t, i) => i === 0 || t > ts[i - 1])).toBe(true);
  });

  it('samples identically for an FTMS rower, the same data path (AC1.3)', () => {
    const pm5 = new WorkoutService();
    pm5.startSession('r1', 'Route 1', undefined, 'pm5', true, false, ROUTE);
    row(pm5, 5);

    const ftms = new WorkoutService();
    ftms.startSession('r1', 'Route 1', undefined, 'ftms', true, false, ROUTE);
    row(ftms, 5);

    expect(ftms.getCurrentSession()!.samples.map((s) => s.t))
      .toEqual(pm5.getCurrentSession()!.samples.map((s) => s.t));
  });

  it('holds ~3,600 samples for a 60-minute row (AC1.5)', () => {
    const svc = new WorkoutService();
    svc.startSession('r1', 'Route 1', undefined, 'pm5', true, false, ROUTE);
    row(svc, 3600);

    // One per elapsed second, inclusive of t=0.
    expect(svc.getCurrentSession()!.samples).toHaveLength(3601);
  });

  it('places samples on the route polyline at the distance rowed (AC1.6)', () => {
    const svc = new WorkoutService();
    svc.startSession('r1', 'Route 1', undefined, 'pm5', true, false, ROUTE);
    row(svc, 100); // 400 m of a ~2 km course

    const samples = svc.getCurrentSession()!.samples;
    // The route runs due east along a line of latitude, so every sample sits on it.
    expect(samples.every((s) => s.lat === 51.5)).toBe(true);
    // Longitude advances monotonically and stops well short of the far end.
    const last = samples[samples.length - 1];
    expect(last.lng!).toBeGreaterThan(ROUTE[0].lng);
    expect(last.lng!).toBeLessThan(ROUTE[1].lng);
    expect(samples[0].lng).toBeCloseTo(ROUTE[0].lng, 6);
  });

  it('reaches the end of the course only when the whole course is rowed (AC1.6)', () => {
    const svc = new WorkoutService();
    svc.startSession('r1', 'Route 1', undefined, 'pm5', true, false, ROUTE);
    row(svc, 600, 10); // 6 km on a ~2 km course — clamped to the finish

    const last = svc.getCurrentSession()!.samples.at(-1)!;
    expect(last.lng).toBeCloseTo(ROUTE[1].lng, 6);
  });

  it('omits position when the session was started without route geometry', () => {
    const svc = new WorkoutService();
    svc.startSession('r1', 'Route 1');
    row(svc, 3);

    expect(svc.getCurrentSession()!.samples.every((s) => s.lat === undefined)).toBe(true);
  });

  it('reads elapsedTime as seconds, the unit both rowers report', () => {
    // Regression: dividing by 1000 left duration and every Split.time at zero
    // for any row under ~17 minutes, and collapsed the stream onto t=0.
    const svc = new WorkoutService();
    svc.startSession('r1', 'Route 1', undefined, 'pm5', true, false, ROUTE);
    svc.updateSessionWithPM5Data({ distance: 0, elapsedTime: 0, pace: 125, power: 180, cadence: 24 });
    svc.updateSessionWithPM5Data({ distance: 500, elapsedTime: 125, pace: 125, power: 180, cadence: 24 });

    const session = svc.getCurrentSession()!;
    expect(session.duration).toBe(125);
    expect(session.splits[0].time).toBe(125);
    expect(session.samples.map((sample) => sample.t)).toEqual([0, 125]);
  });

  it('ends cleanly with no samples when the row is stopped instantly (AC1.7)', () => {
    const svc = new WorkoutService();
    svc.startSession('r1', 'Route 1', undefined, 'pm5', true, false, ROUTE);

    const completed = svc.endSession();
    expect(completed).not.toBeNull();
    expect(completed!.samples).toEqual([]);
  });

  it('starts a fresh series for the next session', () => {
    const svc = new WorkoutService();
    svc.startSession('r1', 'Route 1', undefined, 'pm5', true, false, ROUTE);
    row(svc, 5);
    svc.endSession();

    svc.startSession('r2', 'Route 2', undefined, 'pm5', true, false, ROUTE);
    expect(svc.getCurrentSession()!.samples).toEqual([]);
  });
});
