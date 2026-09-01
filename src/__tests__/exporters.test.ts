import { describe, it, expect } from 'vitest';
import { buildSessionGPX, sessionIdToSerialNumber } from '../utils/exporters';
import type { WorkoutSession, WaterRoute } from '../types/index';

function makeRoute(): WaterRoute {
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
  };
}

function makeSession(overrides: Partial<WorkoutSession> = {}): WorkoutSession {
  const base: WorkoutSession = {
    id: '12345',
    routeId: 'r1',
    routeName: 'Test Route',
    startTime: new Date('2025-01-02T10:00:00Z'),
    duration: 600,
    distance: 1500,
    averagePace: 120,
    calories: 80,
    splits: [
      {
        distance: 500,
        time: 120,
        pace: 120,
        power: 200,
        heartRate: 140,
        timestamp: new Date('2025-01-02T10:02:00Z'),
      },
      {
        distance: 1000,
        time: 240,
        pace: 120,
        power: 210,
        heartRate: 150,
        timestamp: new Date('2025-01-02T10:04:00Z'),
      },
    ],
    isActive: false,
    samples: [],
    heartRateAvg: 145,
    heartRateMax: 160,
  };
  return { ...base, ...overrides };
}

describe('buildSessionGPX', () => {
  it('emits a well-formed GPX 1.1 document', () => {
    const gpx = buildSessionGPX(makeSession(), makeRoute());
    expect(gpx).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(gpx).toContain('<gpx version="1.1" creator="VirtualRow"');
    expect(gpx).toContain('</gpx>');
    expect(gpx).toContain('<name>Test Route</name>');
    expect(gpx).toContain('<time>2025-01-02T10:00:00.000Z</time>');
  });

  it('escapes route names in metadata and track headers', () => {
    const session = makeSession({ routeName: 'Route & <Test>' });
    const gpx = buildSessionGPX(session, makeRoute());
    expect(gpx).toContain('<name>Route &amp; &lt;Test&gt;</name>');
  });

  it('emits one <trkpt> per coordinate, with lat/lon attributes', () => {
    const gpx = buildSessionGPX(makeSession(), makeRoute());
    const trkptMatches = gpx.match(/<trkpt\s+lat="[^"]+"\s+lon="[^"]+">/g) ?? [];
    expect(trkptMatches).toHaveLength(3);
    expect(gpx).toContain('lat="48.1" lon="11.5"');
    expect(gpx).toContain('lat="48.3" lon="11.7"');
  });

  it('produces no <trkpt> entries for an empty route', () => {
    const emptyRoute = { ...makeRoute(), coordinates: [] };
    const gpx = buildSessionGPX(makeSession(), emptyRoute);
    expect(gpx).toContain('<trkseg>');
    expect(gpx).not.toMatch(/<trkpt/);
  });
});

describe('sessionIdToSerialNumber', () => {
  it('parses purely numeric IDs as integers', () => {
    expect(sessionIdToSerialNumber('12345')).toBe(12345);
    expect(sessionIdToSerialNumber('1')).toBe(1);
  });

  it('hashes non-numeric IDs by summing UTF-16 code units', () => {
    // 'abc' = 97 + 98 + 99 = 294
    expect(sessionIdToSerialNumber('abc')).toBe(294);
  });

  it('is deterministic', () => {
    expect(sessionIdToSerialNumber('session-xyz')).toBe(sessionIdToSerialNumber('session-xyz'));
  });
});
