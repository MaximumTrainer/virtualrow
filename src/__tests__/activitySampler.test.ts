import { describe, it, expect } from 'vitest';
import { WorkoutService } from '../lib/services/workoutService';
import { LOOP_CLOSURE_EPSILON_METRES } from '../lib/services/activitySampler';
import type { Coordinate, PM5Data } from '../lib/types/index';

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

  it('omits position for a single-vertex route (issue #466, AC3)', () => {
    // A pinned-start-only route has no polyline to interpolate along; the
    // sampler treats it the same as no geometry so the encoder drops the
    // positionLat/positionLong columns entirely rather than nulling them.
    const svc = new WorkoutService();
    svc.startSession('r1', 'Route 1', undefined, 'pm5', true, false, [{ lat: 51.5, lng: -0.9 }]);
    row(svc, 3);

    expect(svc.getCurrentSession()!.samples.every((s) => s.lat === undefined && s.lng === undefined)).toBe(true);
  });

  it('clamps position to the finish on an open route rowed past its end (issue #466, FR4)', () => {
    // A 2 km route rowed for 6 km at 10 m/s. Every sample past the finish
    // stays on the last coordinate — no extrapolation beyond the polyline.
    const svc = new WorkoutService();
    svc.startSession('r1', 'Route 1', undefined, 'pm5', true, false, ROUTE);
    row(svc, 600, 10);

    const samples = svc.getCurrentSession()!.samples;
    const past = samples.filter((s) => s.distance > 2010);
    expect(past.length).toBeGreaterThan(0);
    expect(past.every((s) => Math.abs(s.lng! - ROUTE[1].lng) < 1e-9)).toBe(true);
  });

  it('wraps position modulo the loop length on a closed loop (issue #466, FR4, D1(b))', () => {
    // A ~2 km north-east loop that closes within D1(b)'s 10 m epsilon. Rowed
    // for 1.5× the loop length, the second half of the row re-visits the
    // first half's coordinates rather than piling on the closing vertex.
    const LOOP: Coordinate[] = [
      { lat: 51.5000, lng: -0.9000 },
      { lat: 51.5050, lng: -0.8950 },
      { lat: 51.5090, lng: -0.8870 },
      { lat: 51.5080, lng: -0.8800 },
      { lat: 51.5040, lng: -0.8830 },
      { lat: 51.5000, lng: -0.8970 },
      { lat: 51.5000, lng: -0.9000 }, // same as first — within 0 m, well below D1(b)
    ];
    const svc = new WorkoutService();
    svc.startSession('r1', 'Route 1', undefined, 'pm5', true, false, LOOP);

    // Discover the loop's total metres from the first-second sample's lat/lng
    // vs. a half-loop sample's lat/lng isn't possible, so compute what the
    // sampler itself ends up seeing: feed enough rowing to clearly span 1.5×.
    row(svc, 1200, 4); // 4800 m rowed; loop is <2 km, so plenty past 1×

    const samples = svc.getCurrentSession()!.samples;
    // A sample at the row's end should NOT coincide with the loop's closing
    // vertex (that would be the open-route clamp behaviour we just left behind).
    const last = samples.at(-1)!;
    const closeToFinalVertex =
      Math.abs(last.lat! - LOOP[LOOP.length - 1].lat) < 1e-9 &&
      Math.abs(last.lng! - LOOP[LOOP.length - 1].lng) < 1e-9;
    expect(closeToFinalVertex).toBe(false);

    // And the exported constant exists so downstream (encoder tests, docs) can
    // reference the same number the sampler uses.
    expect(LOOP_CLOSURE_EPSILON_METRES).toBe(10);
  });

  it('leaves an open route open when the first and last vertices are far apart (issue #466, D1(b))', () => {
    // ROUTE above is a 2 km due-east line — start and finish are >1 km apart,
    // well outside D1(b)'s 10 m epsilon. Rowed past the finish, the sampler
    // clamps instead of wrapping back to the start.
    const svc = new WorkoutService();
    svc.startSession('r1', 'Route 1', undefined, 'pm5', true, false, ROUTE);
    row(svc, 600, 10); // 6 km on a 2 km course

    const last = svc.getCurrentSession()!.samples.at(-1)!;
    expect(last.lng).toBeCloseTo(ROUTE[1].lng, 6);
    // A wrap would land near ROUTE[0].lng; we must not be there.
    expect(Math.abs(last.lng! - ROUTE[0].lng)).toBeGreaterThan(0.01);
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
