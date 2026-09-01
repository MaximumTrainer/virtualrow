import { describe, it, expect } from 'vitest';
import { Decoder, Stream } from '@garmin/fitsdk';
import { encodeSession, FIT_EPOCH_OFFSET_SECONDS } from '../services/fitEncoderService';
import type { ActivitySample, WorkoutSession } from '../types/index';

/**
 * The encoder's primary gate (issue #221, AC2.2): every assertion here goes
 * through Garmin's own `Decoder`, so a bug in our writer cannot be masked by a
 * matching bug in our reader. The SDK is a devDependency — none of it ships.
 */

const START = new Date('2026-03-14T08:00:00Z');

function makeSample(t: number, overrides: Partial<ActivitySample> = {}): ActivitySample {
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

function makeSession(overrides: Partial<WorkoutSession> = {}): WorkoutSession {
  return {
    id: '1773475200000',
    routeId: 'r1',
    routeName: 'Willowbrook River',
    startTime: START,
    endTime: new Date(START.getTime() + 10_000),
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
 * Decode with the SDK, asserting the file is intact on the way through.
 * `checkIntegrity()` verifies both the header CRC and the trailing file CRC.
 */
function decode(bytes: Uint8Array) {
  const stream = Stream.fromByteArray(Array.from(bytes));
  expect(Decoder.isFIT(stream)).toBe(true);
  const decoder = new Decoder(stream);
  expect(decoder.checkIntegrity()).toBe(true);
  const { messages, errors } = decoder.read();
  expect(errors).toEqual([]);
  return {
    fileIds: messages.fileIdMesgs ?? [],
    events: messages.eventMesgs ?? [],
    records: messages.recordMesgs ?? [],
    laps: messages.lapMesgs ?? [],
    sessions: messages.sessionMesgs ?? [],
    activities: messages.activityMesgs ?? [],
    json: JSON.stringify(messages),
  };
}

describe('fitEncoderService (issue #221, R2)', () => {
  it('writes a file with a valid header and file CRC (AC2.1)', () => {
    const bytes = encodeSession(makeSession());
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes[0]).toBe(14); // header size
    expect(String.fromCharCode(...bytes.slice(8, 12))).toBe('.FIT');
    decode(bytes);
  });

  it('round-trips record count, distance, duration and sport (AC2.2)', () => {
    const session = makeSession();
    const decoded = decode(encodeSession(session));

    expect(decoded.records).toHaveLength(session.samples.length);
    const [sessionMesg] = decoded.sessions;
    expect(sessionMesg.totalDistance).toBeCloseTo(session.distance, 2);
    expect(sessionMesg.totalElapsedTime).toBeCloseTo(session.duration, 3);
    expect(sessionMesg.totalTimerTime).toBeCloseTo(session.duration, 3);
    expect(sessionMesg.sport).toBe('rowing');
  });

  it('honours the FIT scale=100 on every distance (AC2.2)', () => {
    // Carried over from the deleted JSON projection's units contract (AC2.9):
    // an encoder that forgets scale=100 under-reports distance by 100×, and a
    // round-trip through the SDK is what proves it did not.
    const session = makeSession({ distance: 2345.67 });
    const decoded = decode(encodeSession(session));
    expect(decoded.sessions[0].totalDistance).toBeCloseTo(2345.67, 2);
    expect(decoded.records.at(-1)?.distance).toBeCloseTo(session.samples.at(-1)!.distance, 2);
  });

  it('is rowing on an indoor rower, and nothing else, anywhere (AC2.3)', () => {
    const decoded = decode(encodeSession(makeSession()));
    expect(decoded.sessions[0].sport).toBe('rowing');
    expect(decoded.sessions[0].subSport).toBe('indoorRowing');
    expect(decoded.json).not.toMatch(/cycling|running/i);
  });

  it('times from the FIT epoch and positions in semicircles (AC2.4)', () => {
    const session = makeSession();
    const [first] = decode(encodeSession(session)).records;

    expect(new Date(first.timestamp as Date).toISOString()).toBe(START.toISOString());

    // Positions decode as raw semicircles: degrees × 2^31 / 180.
    const toSemicircles = (degrees: number) => (degrees * 2 ** 31) / 180;
    expect(Math.abs(first.positionLat! - toSemicircles(session.samples[0].lat!))).toBeLessThanOrEqual(1);
    expect(Math.abs(first.positionLong! - toSemicircles(session.samples[0].lng!))).toBeLessThanOrEqual(1);
    expect(Number.isInteger(first.positionLat)).toBe(true);
  });

  it('anchors the FIT epoch at 1989-12-31T00:00:00Z (AC2.4)', () => {
    expect(FIT_EPOCH_OFFSET_SECONDS).toBe(Date.UTC(1989, 11, 31) / 1000);
  });

  it('omits heart rate entirely for a row with no strap (AC2.5)', () => {
    const decoded = decode(encodeSession(makeSession({
      samples: Array.from({ length: 5 }, (_, t) => makeSample(t, { heartRate: undefined })),
      heartRateAvg: undefined,
      heartRateMax: undefined,
    })));

    expect(decoded.records.every((record) => record.heartRate === undefined)).toBe(true);
    expect(decoded.sessions[0].avgHeartRate).toBeUndefined();
    // A row at 0 bpm is the failure this guards against.
    expect(decoded.json).not.toMatch(/"heartRate":0/);
  });

  it('omits a single sample gap without dropping the field for the others (AC2.5)', () => {
    const samples = [makeSample(0), makeSample(1, { power: undefined }), makeSample(2)];
    const decoded = decode(encodeSession(makeSession({ samples })));

    expect(decoded.records.map((record) => record.power)).toEqual([180, undefined, 180]);
  });

  it('writes one lap per 500 m split (AC2.6)', () => {
    const splits = [500, 1000, 1500].map((distance, i) => ({
      distance,
      time: (i + 1) * 125,
      pace: 125,
      power: 180,
      heartRate: 130 + i,
      timestamp: new Date(START.getTime() + (i + 1) * 125_000),
    }));
    const decoded = decode(encodeSession(makeSession({ splits, distance: 1500, duration: 375 })));

    expect(decoded.laps).toHaveLength(3);
    expect(decoded.laps.map((lap) => Math.round(lap.totalDistance!))).toEqual([500, 500, 500]);
    expect(decoded.laps.map((lap) => lap.messageIndex)).toEqual([0, 1, 2]);
    expect(decoded.laps.map((lap) => lap.avgHeartRate)).toEqual([130, 131, 132]);
    expect(decoded.sessions[0].numLaps).toBe(3);
  });

  it('writes a single lap covering the row when no split was reached (AC2.6)', () => {
    const decoded = decode(encodeSession(makeSession()));
    expect(decoded.laps).toHaveLength(1);
    expect(decoded.laps[0].totalDistance).toBeCloseTo(36, 2);
  });

  it('brackets the records with timer start and stop events', () => {
    const decoded = decode(encodeSession(makeSession()));
    expect(decoded.events.map((event) => event.eventType)).toEqual(['start', 'stop']);
  });

  it('identifies the file and the activity', () => {
    const decoded = decode(encodeSession(makeSession()));
    expect(decoded.fileIds[0].type).toBe('activity');
    expect(decoded.fileIds[0].serialNumber).toBe(1773475200000 % 2 ** 32);
    expect(decoded.activities[0].numSessions).toBe(1);
    expect(decoded.activities[0].totalTimerTime).toBeCloseTo(10, 3);
  });

  it('is a pure function — the same session encodes to the same bytes (AC2.7)', () => {
    const session = makeSession();
    expect(Array.from(encodeSession(session))).toEqual(Array.from(encodeSession(session)));
  });

  it('encodes a row with no samples as an activity with no records (AC1.7)', () => {
    const decoded = decode(encodeSession(makeSession({ samples: [], distance: 0, duration: 1 })));
    expect(decoded.records).toEqual([]);
    expect(decoded.sessions).toHaveLength(1);
  });

  it('omits position for samples recorded without route geometry', () => {
    const samples = Array.from({ length: 3 }, (_, t) => makeSample(t, { lat: undefined, lng: undefined }));
    const decoded = decode(encodeSession(makeSession({ samples })));
    expect(decoded.records.every((record) => record.positionLat === undefined)).toBe(true);
  });
});
