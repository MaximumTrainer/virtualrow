import { describe, it, expect } from 'vitest';
import { WorkoutService, SPLIT_DISTANCE_METERS } from '../services/workoutService';
import type { PM5Data } from '../types/index';

/**
 * Regression + bug-spec tests for activity distance handling.
 *
 * These accompany the investigation in
 *   issue: "activity distance may not be calculated correctly".
 *
 * Tests marked with `.fails` document KNOWN BUGS in
 * `WorkoutService.updateSessionWithPM5Data` — they are expected to fail until
 * the fix lands. When the fix lands the `.fails` modifier should be removed
 * (vitest will start failing the run, flagging the maintainer).
 */

function pm5(data: Partial<PM5Data>): PM5Data {
  return {
    distance: 0,
    elapsedTime: 0,
    pace: 0,
    power: 0,
    cadence: 0,
    heartRate: 0,
    calories: 0,
    ...data,
  };
}

describe('WorkoutService — distance handling (current behavior)', () => {
  it('mirrors device distance directly into the session on each update', () => {
    const svc = new WorkoutService();
    svc.startSession('r1', 'Route 1');
    svc.updateSessionWithPM5Data(pm5({ distance: 250, elapsedTime: 60_000 }));
    expect(svc.getCurrentSession()!.distance).toBe(250);

    svc.updateSessionWithPM5Data(pm5({ distance: 500, elapsedTime: 120_000 }));
    expect(svc.getCurrentSession()!.distance).toBe(500);
  });

  it(`emits a split once cumulative distance crosses ${SPLIT_DISTANCE_METERS} m`, () => {
    const svc = new WorkoutService();
    svc.startSession('r2', 'Route 2');
    svc.updateSessionWithPM5Data(pm5({ distance: 499, elapsedTime: 90_000 }));
    expect(svc.getCurrentSession()!.splits.length).toBe(0);
    svc.updateSessionWithPM5Data(pm5({ distance: 500, elapsedTime: 91_000 }));
    expect(svc.getCurrentSession()!.splits.length).toBe(1);
  });
});

describe('WorkoutService — distance handling (known bugs, expected to fail until fixed)', () => {
  // TODO(activity-distance-bug): when fixed, remove `.fails` from every test in
  // this describe block so they enforce the corrected behavior. Each test below
  // also carries a per-bug TODO with the specific defect it covers.

  // TODO(activity-distance-bug): H1 destructive overwrite — `updateSessionWithPM5Data`
  // mirrors `data.distance` directly into `session.distance`, so a transient stale
  // or zero packet wipes the running total. Fix: accumulate deltas (and clamp
  // negative deltas to 0) instead of overwriting. Remove `.fails` once fixed.
  it.fails('does not lose distance when a transient zero/stale packet arrives', () => {
    const svc = new WorkoutService();
    svc.startSession('r-overwrite', 'Overwrite Repro');

    // User rows steadily to 1234 m.
    svc.updateSessionWithPM5Data(pm5({ distance: 1234, elapsedTime: 240_000 }));
    expect(svc.getCurrentSession()!.distance).toBe(1234);

    // BLE re-subscribe / monitor blip: a single stale frame reports 0 m.
    svc.updateSessionWithPM5Data(pm5({ distance: 0, elapsedTime: 241_000 }));
    // Next real frame arrives shortly after, slightly past the blip.
    svc.updateSessionWithPM5Data(pm5({ distance: 50, elapsedTime: 242_000 }));

    // BUG: current code overwrites session.distance with 50, losing 1184 m.
    // Required behavior: the session total must be monotonically non-decreasing.
    expect(svc.getCurrentSession()!.distance).toBeGreaterThanOrEqual(1234);
  });

  // TODO(activity-distance-bug): split detector compares `lastSplit.distance`
  // against `data.distance`, so after a backward jump the comparison misses
  // 500 m boundaries. Tied to the H1 fix above — once distance accumulates
  // correctly, the split detector should follow. Remove `.fails` when fixed.
  it.fails('still records splits after recovering from a transient backwards jump', () => {
    const svc = new WorkoutService();
    svc.startSession('r-splits', 'Split Repro');

    // Pass 1500 m → first split should already exist.
    svc.updateSessionWithPM5Data(pm5({ distance: 1500, elapsedTime: 300_000 }));
    expect(svc.getCurrentSession()!.splits.length).toBeGreaterThanOrEqual(1);

    // Blip drops device distance back to 0, then resumes climbing.
    svc.updateSessionWithPM5Data(pm5({ distance: 0, elapsedTime: 301_000 }));
    svc.updateSessionWithPM5Data(pm5({ distance: 1800, elapsedTime: 360_000 }));

    // BUG: lastSplit.distance is still 1500, but data.distance went 1500 → 0 → 1800,
    // so the split detector compares 1800 - 1500 = 300 and emits NO new split,
    // even though we have rowed > 500 m since the previous split.
    // Required behavior: exactly one new split for crossing the 2nd 500 m boundary
    // (totalling at least 2 splits, i.e. one new split after the 1500 m mark).
    const splits = svc.getCurrentSession()!.splits;
    expect(splits.length).toBeGreaterThanOrEqual(2);
  });

  // TODO(activity-distance-bug): H2 start-offset — the first PM5 frame's
  // `distance` should be captured as a session origin and subtracted from all
  // subsequent readings. Today it is recorded verbatim, so mid-row connects or
  // FTMS devices that report lifetime odometer inflate the session total.
  // Remove `.fails` when the offset is implemented.
  // H1 (start-offset): mid-row connect / lifetime-odometer device.
  it.fails('treats the first device reading as the session-start offset (does not inherit a non-zero baseline)', () => {
    const svc = new WorkoutService();
    svc.startSession('r-offset', 'Offset Repro');

    // First packet arrives with the device already at 5000 m (mid-row connect,
    // or an FTMS implementation that reports lifetime odometer).
    svc.updateSessionWithPM5Data(pm5({ distance: 5000, elapsedTime: 1_000 }));
    // Then the user rows another 200 m.
    svc.updateSessionWithPM5Data(pm5({ distance: 5200, elapsedTime: 60_000 }));

    // BUG: session.distance = 5200, exporting 5200 m of "rowed" distance.
    // Required behavior: session.distance reflects ~200 m (what the user actually
    // rowed during this session), not the device's pre-session baseline.
    expect(svc.getCurrentSession()!.distance).toBeLessThan(1000);
  });

  // TODO(activity-distance-bug): H3 pause API — `WorkoutService` has no
  // `pauseSession()`/`resumeSession()`. The UI shows a paused state but PM5
  // packets still mutate `session.distance` underneath. Add the API and gate
  // `updateSessionWithPM5Data` on it. Remove `.fails` when implemented.
  // Pause is currently UI-only — workoutService keeps accepting distance updates.
  it.fails('exposes a paused state that suspends distance accumulation', () => {
    const svc = new WorkoutService() as WorkoutService & {
      pauseSession?: () => void;
      resumeSession?: () => void;
    };
    svc.startSession('r-pause', 'Pause Repro');
    svc.updateSessionWithPM5Data(pm5({ distance: 300, elapsedTime: 60_000 }));

    // BUG: workoutService has no pauseSession()/resumeSession() API today, so
    // packets that arrive while the UI shows "paused" still mutate session.distance.
    // Required behavior: while paused, additional PM5 packets must not advance
    // session.distance.
    expect(typeof svc.pauseSession).toBe('function');
    svc.pauseSession!();
    svc.updateSessionWithPM5Data(pm5({ distance: 600, elapsedTime: 120_000 }));
    expect(svc.getCurrentSession()!.distance).toBe(300);
  });
});
