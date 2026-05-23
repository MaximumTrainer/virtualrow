import { describe, it, expect } from 'vitest';
import { WorkoutService, SPLIT_DISTANCE_METERS } from '../services/workoutService';
import type { PM5Data } from '../types/index';

/**
 * Regression + bug-spec tests for activity distance handling.
 *
 * These accompany the investigation in
 *   issue: "activity distance may not be calculated correctly".
 *
 * IMPORTANT: The React display must always read `workoutService.getCurrentSession()` to
 * build the state update (not `{ ...prevReactStateCopy }`).  After the first state spread,
 * React state points to a snapshot copy — subsequent spreads of *that copy* will freeze
 * distance at its value at first-spread time (typically 0).
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

describe('WorkoutService — distance handling', () => {
  it('treats the first device reading as the session-start offset', () => {
    const svc = new WorkoutService();
    svc.startSession('r1', 'Route 1');
    svc.updateSessionWithPM5Data(pm5({ distance: 5000, elapsedTime: 1_000 }));
    expect(svc.getCurrentSession()!.distance).toBe(0);

    svc.updateSessionWithPM5Data(pm5({ distance: 5200, elapsedTime: 60_000 }));
    expect(svc.getCurrentSession()!.distance).toBe(200);
  });

  it(`emits a split once cumulative distance crosses ${SPLIT_DISTANCE_METERS} m`, () => {
    const svc = new WorkoutService();
    svc.startSession('r2', 'Route 2');
    svc.updateSessionWithPM5Data(pm5({ distance: 0, elapsedTime: 0 }));
    svc.updateSessionWithPM5Data(pm5({ distance: 499, elapsedTime: 90_000 }));
    expect(svc.getCurrentSession()!.splits.length).toBe(0);
    svc.updateSessionWithPM5Data(pm5({ distance: 500, elapsedTime: 91_000 }));
    expect(svc.getCurrentSession()!.splits.length).toBe(1);
  });
});

describe('WorkoutService — distance handling (regressions)', () => {
  it('does not lose distance when a transient zero/stale packet arrives', () => {
    const svc = new WorkoutService();
    svc.startSession('r-overwrite', 'Overwrite Repro');
    svc.updateSessionWithPM5Data(pm5({ distance: 0, elapsedTime: 0 }));

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

  it('records splits based on monotonic session distance after a transient backwards jump', () => {
    const svc = new WorkoutService();
    svc.startSession('r-splits', 'Split Repro');
    svc.updateSessionWithPM5Data(pm5({ distance: 0, elapsedTime: 0 }));

    // Pass 1500 m → 3 splits should exist (500, 1000, 1500).
    svc.updateSessionWithPM5Data(pm5({ distance: 1500, elapsedTime: 300_000 }));
    expect(svc.getCurrentSession()!.splits.map((s) => s.distance)).toEqual([500, 1000, 1500]);

    // Blip drops device distance back to 0, then resumes climbing.
    svc.updateSessionWithPM5Data(pm5({ distance: 0, elapsedTime: 301_000 }));
    svc.updateSessionWithPM5Data(pm5({ distance: 1800, elapsedTime: 360_000 }));

    const splits = svc.getCurrentSession()!.splits;
    expect(splits.map((s) => s.distance)).toEqual([500, 1000, 1500]);
  });

  it('does not inherit a non-zero baseline from the device', () => {
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

  it('exposes a paused state that suspends distance accumulation', () => {
    const svc = new WorkoutService() as WorkoutService & {
      pauseSession?: () => void;
      resumeSession?: () => void;
    };
    svc.startSession('r-pause', 'Pause Repro');
    svc.updateSessionWithPM5Data(pm5({ distance: 0, elapsedTime: 0 }));
    svc.updateSessionWithPM5Data(pm5({ distance: 300, elapsedTime: 60_000 }));

    expect(typeof svc.pauseSession).toBe('function');
    svc.pauseSession!();
    svc.updateSessionWithPM5Data(pm5({ distance: 600, elapsedTime: 120_000 }));
    expect(svc.getCurrentSession()!.distance).toBe(300);
  });

  it('getCurrentSession() always returns the live mutated session, not a snapshot', () => {
    // Regression: React display must call getCurrentSession() to build state updates.
    // If you spread a React-state copy (prev => { ...prev }) the second spread will
    // re-use the first snapshot distance, freezing it at its initial value (0).
    const svc = new WorkoutService();
    svc.startSession('r-live', 'Live Session');

    svc.updateSessionWithPM5Data(pm5({ distance: 0, elapsedTime: 0 }));
    // Simulate what React does on first render tick: take a snapshot copy
    const snapshot1 = { ...svc.getCurrentSession()! };
    expect(snapshot1.distance).toBe(0);

    // Session accumulates more distance
    svc.updateSessionWithPM5Data(pm5({ distance: 250, elapsedTime: 50_000 }));
    svc.updateSessionWithPM5Data(pm5({ distance: 500, elapsedTime: 100_000 }));

    // BAD PATTERN: spreading the stale snapshot gives wrong distance
    const staleCopy = { ...snapshot1 };
    expect(staleCopy.distance).toBe(0); // frozen at first-snapshot value

    // CORRECT PATTERN: read from service gives live distance
    const liveSession = svc.getCurrentSession()!;
    expect(liveSession.distance).toBe(500); // up-to-date
    const correctCopy = { ...liveSession };
    expect(correctCopy.distance).toBe(500);
  });
});
