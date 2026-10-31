// ============================================================================
// Shared fixtures for the FIT encoder + upload tests (issue #446).
//
// The unit test (fitEncoderService.test.ts) and the round-trip integration
// test (fitUploadRoundTrip.test.ts) both build sessions from these factories
// so a change to the shape flows through both — the round-trip test is the
// one intervals.icu's own importer is tested against.
// ============================================================================

import type { ActivitySample, Coordinate, Split, WorkoutSession } from '../../lib/types/index';
import { cumulativeLengths, interpolateAlong } from '../../lib/utils/polylineGeometry';

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

/**
 * A closed-loop polyline whose last vertex coincides with its first (issue
 * #466, AC10). Chosen north-east loop is short enough (~1.9 km measured) that
 * a session can comfortably row 1.5× its length and the sampler's modulo-wrap
 * can be observed in the FIT trace, but long enough to carry a handful of
 * laps for the FitCSVTool structural gate.
 */
export const LOOP_ROUTE: Coordinate[] = [
  { lat: 51.5000, lng: -0.9000 },
  { lat: 51.5050, lng: -0.8950 },
  { lat: 51.5090, lng: -0.8870 },
  { lat: 51.5080, lng: -0.8800 },
  { lat: 51.5040, lng: -0.8830 },
  { lat: 51.5000, lng: -0.8970 },
  { lat: 51.5000, lng: -0.9000 },
];

/**
 * A two-vertex "gate-chain" polyline (issue #466, AC10). Mirrors the shape a
 * rownative gate-chain route produces: a straight start→finish line with no
 * mid-route geometry, exercising the FIT writer against the degenerate but
 * supported polyline.
 */
export const GATE_CHAIN_ROUTE: Coordinate[] = [
  { lat: 51.5000, lng: -0.9000 },
  { lat: 51.5080, lng: -0.8700 },
];

/**
 * A ~10-minute session rowed over a short closed loop (#466, AC10 / FR4).
 * The row runs for 1.5× the loop length so lat/lng wraps modulo the loop
 * length — the trace covers each coordinate on the loop twice, which is
 * what the sampler's `isClosedLoop` path emits and the file FitCSVTool
 * must still accept as structurally valid.
 */
export function buildLoopRouteSession(): WorkoutSession {
  const route = LOOP_ROUTE;
  const cumulative = cumulativeLengths(route);
  const loopMetres = cumulative[cumulative.length - 1];
  const totalMetres = Math.round(loopMetres * 1.5); // one and a half laps
  const speedMps = 4;
  const totalSeconds = Math.round(totalMetres / speedMps);
  const lapMetres = 500;

  const samples: ActivitySample[] = Array.from({ length: totalSeconds }, (_, t) => {
    const distance = t * speedMps;
    const wrapped = ((distance % loopMetres) + loopMetres) % loopMetres;
    const { lat, lng } = interpolateAlong(route, wrapped, cumulative);
    return {
      t,
      distance,
      pace: 125,
      power: 190,
      cadence: 24,
      heartRate: 135 + Math.round(5 * Math.sin(t / 20)),
      lat,
      lng,
    };
  });

  const splitCount = Math.floor(totalMetres / lapMetres);
  const splits: Split[] = Array.from({ length: splitCount }, (_, i) => ({
    distance: (i + 1) * lapMetres,
    time: ((i + 1) * lapMetres) / speedMps,
    pace: 125,
    power: 190,
    heartRate: 135,
    timestamp: new Date(FIXTURE_START.getTime() + ((i + 1) * lapMetres * 1000) / speedMps),
  }));

  return {
    id: FIXTURE_SESSION_ID,
    routeId: 'loop-route-fixture',
    routeName: 'Loop route fixture',
    startTime: FIXTURE_START,
    endTime: new Date(FIXTURE_START.getTime() + totalSeconds * 1000),
    duration: totalSeconds,
    distance: totalMetres,
    averagePace: 125,
    calories: 180,
    splits,
    isActive: false,
    heartRateAvg: 135,
    heartRateMax: 142,
    samples,
  };
}

/**
 * A short session rowed over a two-vertex gate-chain polyline (#466, AC10 /
 * FR6). The sampler still interpolates lat/lng along the straight line
 * between the gates — the SessionSummary chip tells the user it is schematic
 * (`AC6`) — and the FIT writer must still emit a structurally valid file.
 */
export function buildGateChainSession(): WorkoutSession {
  const route = GATE_CHAIN_ROUTE;
  const cumulative = cumulativeLengths(route);
  const totalMetres = cumulative[cumulative.length - 1];
  const speedMps = 4;
  const totalSeconds = Math.round(totalMetres / speedMps);
  const lapMetres = 500;

  const samples: ActivitySample[] = Array.from({ length: totalSeconds }, (_, t) => {
    const distance = Math.min(t * speedMps, totalMetres);
    const { lat, lng } = interpolateAlong(route, distance, cumulative);
    return {
      t,
      distance,
      pace: 125,
      power: 185,
      cadence: 23,
      heartRate: 130,
      lat,
      lng,
    };
  });

  const splitCount = Math.max(1, Math.floor(totalMetres / lapMetres));
  const splits: Split[] = Array.from({ length: splitCount }, (_, i) => ({
    distance: (i + 1) * lapMetres,
    time: ((i + 1) * lapMetres) / speedMps,
    pace: 125,
    power: 185,
    heartRate: 130,
    timestamp: new Date(FIXTURE_START.getTime() + ((i + 1) * lapMetres * 1000) / speedMps),
  }));

  return {
    id: FIXTURE_SESSION_ID,
    routeId: 'gate-chain-fixture',
    routeName: 'Gate-chain fixture',
    startTime: FIXTURE_START,
    endTime: new Date(FIXTURE_START.getTime() + totalSeconds * 1000),
    duration: totalSeconds,
    distance: Math.round(totalMetres),
    averagePace: 125,
    calories: 110,
    splits,
    isActive: false,
    heartRateAvg: 130,
    heartRateMax: 134,
    samples,
  };
}
