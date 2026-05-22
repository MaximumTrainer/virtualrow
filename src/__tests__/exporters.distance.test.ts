import { describe, it, expect } from 'vitest';
import { buildSessionGPX, buildSessionFITPayload } from '../utils/exporters';
import type { WorkoutSession, WaterRoute } from '../types/index';

/**
 * Distance-fidelity tests for the activity export path.
 *
 * Companion to the investigation in
 *   issue: "activity distance may not be calculated correctly".
 *
 * These cover two export-side defects that surface as wrong distances on
 * third-party platforms (e.g. Intervals.icu):
 *   - GPX exports only emit the static route polyline, so platforms that
 *     derive distance via haversine on the trkpts get the route's nominal
 *     length, not what was actually rowed.
 *   - The FIT JSON projection's `session.total_distance` carries meters as a
 *     plain number with no scale documented; a future binary encoder that
 *     forgets the FIT spec's `scale=100` for `session.total_distance` will
 *     under-report by 100×.
 *
 * Tests marked `.fails` document known gaps; flip the modifier when fixed.
 */

function makeRoute(overrides: Partial<WaterRoute> = {}): WaterRoute {
  return {
    id: 'r1',
    name: 'Test Route',
    description: 'desc',
    distance: 5,
    difficulty: 'easy',
    location: 'Anywhere',
    coordinates: [
      { lat: 48.1, lng: 11.5 },
      { lat: 48.2, lng: 11.6 },
      { lat: 48.3, lng: 11.7 },
    ],
    elevationGain: 0,
    estimatedTime: 30,
    tags: ['test'],
    createdAt: new Date('2025-01-01T00:00:00Z'),
    ...overrides,
  };
}

function makeSession(overrides: Partial<WorkoutSession> = {}): WorkoutSession {
  return {
    id: '12345',
    routeId: 'r1',
    routeName: 'Test Route',
    startTime: new Date('2025-01-02T10:00:00Z'),
    duration: 600,
    distance: 1500,
    averagePace: 120,
    calories: 80,
    splits: [],
    isActive: false,
    ...overrides,
  };
}

describe('FIT export — distance units contract', () => {
  it('serializes session.total_distance as meters with no scale applied (numbers must match exactly)', () => {
    const payload = buildSessionFITPayload(makeSession({ distance: 2345.6 }));
    // Locks in the unit contract: the JSON projection carries meters as-is.
    // Any future binary FIT encoder MUST multiply by 100 to honour the FIT spec's
    // `scale=100` for session.total_distance — see exporters.ts comment.
    expect(payload.session.total_distance).toBe(2345.6);
  });

  it('preserves per-record split distance in meters (no rounding, no scaling)', () => {
    const session = makeSession({
      distance: 1500,
      splits: [
        {
          distance: 500.2,
          time: 120,
          pace: 120,
          power: 200,
          heartRate: 140,
          timestamp: new Date('2025-01-02T10:02:00Z'),
        },
      ],
    });
    const payload = buildSessionFITPayload(session);
    expect(payload.records).toHaveLength(1);
    expect(payload.records[0].distance).toBe(500.2);
  });
});

describe('GPX export — rowed distance fidelity (known bug, expected to fail until fixed)', () => {
  it.fails('embeds the actual rowed distance so consumers do not derive it from the static polyline', () => {
    // The session covered 1500 m. The route polyline (lat/lng above) spans
    // ~22 km along its great-circle, so any consumer that computes distance
    // by haversining the <trkpt> coordinates will see 22000+ m, not 1500.
    const gpx = buildSessionGPX(makeSession({ distance: 1500 }), makeRoute());

    // Required behavior: the rowed distance (1500 m) appears somewhere
    // machine-parsable in the GPX — e.g. as a <gpxtpx:Distance> extension,
    // a <metadata>/<desc> field, or a <trk>/<extensions> block.
    // Right now the exporter emits only the static route polyline with no
    // rowed-distance element at all.
    expect(gpx).toMatch(/1500/);
  });

  it.fails('omits no rowed-track information when the route polyline is empty', () => {
    // Edge case: route has no coordinates (e.g. custom free-row activity).
    // Today the GPX is essentially empty <trkseg></trkseg> with no distance
    // information at all, so platforms record a 0-length activity.
    const gpx = buildSessionGPX(
      makeSession({ distance: 2000 }),
      makeRoute({ coordinates: [] }),
    );
    expect(gpx).toMatch(/2000/);
  });
});
