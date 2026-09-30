// ============================================================================
// Shared fixtures for the FIT encoder + upload tests (issue #446).
//
// The unit test (fitEncoderService.test.ts) and the round-trip integration
// test (fitUploadRoundTrip.test.ts) both build sessions from these factories
// so a change to the shape flows through both — the round-trip test is the
// one intervals.icu's own importer is tested against.
// ============================================================================

import type { ActivitySample, Split, WorkoutSession } from '../../types/index';

/**
 * Fixed timestamp for the round-trip fixture (issue #446, AC1).
 *
 * Every field derived from time — record timestamps, event bracketing, lap
 * boundaries, the file's serial number — is a function of this constant, so
 * `encodeSession(buildRealisticSession())` is byte-stable across machines and
 * commits and the checked-in `.fit` fixture can be diffed on review.
 */
export const FIXTURE_START = new Date('2026-03-14T08:00:00Z');

/** Session id derived from the start time; the encoder uses it as the file's serial number. */
export const FIXTURE_SESSION_ID = String(FIXTURE_START.getTime());

export function makeSample(t: number, overrides: Partial<ActivitySample> = {}): ActivitySample {
  return {
    t,
    distance: t * 4,
    pace: 125,
    power: 180,
    cadence: 24,
    heartRate: 132,
    lat: 51.5 + t * 0.0001,
    lng: -0.9 + t * 0.0002,
    ...overrides,
  };
}

export function makeSession(overrides: Partial<WorkoutSession> = {}): WorkoutSession {
  return {
    id: '1773475200000',
    routeId: 'r1',
    routeName: 'Willowbrook River',
    startTime: FIXTURE_START,
    endTime: new Date(FIXTURE_START.getTime() + 10_000),
    duration: 10,
    distance: 36,
    averagePace: 125,
    calories: 12,
    splits: [],
    isActive: false,
    heartRateAvg: 132,
    heartRateMax: 147,
    samples: Array.from({ length: 10 }, (_, t) => makeSample(t)),
    ...overrides,
  };
}

/**
 * A realistic ~20 min / 5 km session with ten 500 m splits at 1 Hz on a
 * synthetic polyline heading north-north-east from 51.5°N, 0.9°W (issue #446,
 * D1(a)).
 *
 * The row is 5000 m at exactly 4 m/s = 1250 s (20:50), split every 500 m.
 * The encoder writes one lap per 500 m split (its long-standing convention;
 * `fitEncoderService.ts:249`), so ten laps of 500 m sum to the session's
 * 5000 m within a byte — which is what intervals.icu's importer expects and
 * what `fitUploadRoundTrip.test.ts` asserts (AC1, D6(a)).
 *
 * Every stream (HR, power, cadence, pace, GPS) is modulated deterministically
 * with a smooth function of `t` — no RNG — so the encoder's output is byte-
 * stable and reviewers see any encoder change as a fixture diff (FR2).
 */
export function buildRealisticSession(): WorkoutSession {
  const totalSeconds = 1250;
  const speedMps = 4;
  const totalMetres = totalSeconds * speedMps; // 5000
  const lapMetres = 500;
  const lapSeconds = lapMetres / speedMps; // 125
  const lapCount = totalMetres / lapMetres; // 10

  const samples: ActivitySample[] = Array.from({ length: totalSeconds }, (_, t) => {
    // Smooth HR climb from 128 to 168 bpm with a slow oscillation on top.
    const heartRate = Math.round(128 + (t / totalSeconds) * 40 + 3 * Math.sin(t / 45));
    // Steady 200 W with a stroke-scale oscillation.
    const power = Math.round(200 + 20 * Math.sin(t / 8));
    // Cadence rises with pace effort: 22→28 spm.
    const cadence = Math.round(22 + (t / totalSeconds) * 6);
    // Pace mirrors constant speed: 500 / 4 = 125 s/500m.
    const pace = 125;
    return {
      t,
      distance: t * speedMps,
      pace,
      power,
      cadence,
      heartRate,
      // North-north-east walk from 51.5°N, 0.9°W across ~0.05° of latitude and
      // ~0.10° of longitude over the session. Well inside FIT's valid range.
      lat: 51.5 + t * 0.00004,
      lng: -0.9 + t * 0.00008,
    };
  });

  const splits: Split[] = Array.from({ length: lapCount }, (_, i) => ({
    distance: (i + 1) * lapMetres,
    time: (i + 1) * lapSeconds,
    pace: 125,
    power: 200,
    heartRate: 130 + i,
    timestamp: new Date(FIXTURE_START.getTime() + (i + 1) * lapSeconds * 1000),
  }));

  return {
    id: FIXTURE_SESSION_ID,
    routeId: 'willowbrook-river',
    routeName: 'Willowbrook River',
    startTime: FIXTURE_START,
    endTime: new Date(FIXTURE_START.getTime() + totalSeconds * 1000),
    duration: totalSeconds,
    distance: totalMetres,
    averagePace: 125,
    calories: 320,
    splits,
    isActive: false,
    heartRateAvg: 148,
    heartRateMax: 168,
    samples,
  };
}
