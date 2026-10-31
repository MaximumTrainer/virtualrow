import { describe, it, expect } from 'vitest';
import { Decoder, Stream } from '@garmin/fitsdk';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { encodeSession } from '../lib/services/fitEncoderService';
import {
  buildGateChainSession,
  buildLoopRouteSession,
  buildRealisticSession,
  GATE_CHAIN_ROUTE,
  LOOP_ROUTE,
} from './__helpers__/fitFixture';
import { cumulativeLengths } from '../lib/utils/polylineGeometry';

/**
 * End-to-end evidence that intervals.icu's own importer will accept the bytes
 * `fitEncoderService` emits (issue #446, FR1). Every assertion here is a field
 * intervals.icu is known to display on an activity page — a shape Garmin's
 * decoder alone tolerates but intervals.icu rejects would slip through the
 * per-message unit tests.
 *
 * The same encoded bytes are checked in at `__fixtures__/sample-session.fit`
 * (FR2). A change to the encoder that touches the wire format shows up as a
 * diff on that file in review, and the diff is regenerable with a documented
 * single command:
 *
 *     UPDATE_FIT_FIXTURE=1 npx vitest run src/__tests__/fitUploadRoundTrip.test.ts
 */

const FIXTURE_PATH = resolve(__dirname, '__fixtures__/sample-session.fit');
const LOOP_FIXTURE_PATH = resolve(__dirname, '__fixtures__/loop-route.fit');
const GATE_CHAIN_FIXTURE_PATH = resolve(__dirname, '__fixtures__/gate-chain.fit');

const UPDATE = process.env.UPDATE_FIT_FIXTURE === '1';

const session = buildRealisticSession();
const encoded = encodeSession(session);

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
  };
}

describe('FIT upload round-trip (issue #446, AC1)', () => {
  const decoded = decode(encoded);

  it('is a FIT Activity file', () => {
    expect(decoded.fileIds[0].type).toBe('activity');
  });

  it('is indoor rowing, and only rowing', () => {
    // intervals.icu reads the sport from the session message, not the file id;
    // a mismatch here would show the row as the wrong sport on the account page.
    expect(decoded.sessions[0].sport).toBe('rowing');
    expect(decoded.sessions[0].subSport).toBe('indoorRowing');
  });

  it('is a manually-created activity', () => {
    // intervals.icu uses activity.type to decide the "source" tag on the row.
    // The Garmin SDK exposes activity.type as `type` on the decoded message.
    const [activity] = decoded.activities;
    expect(activity.type).toBe('manual');
  });

  it('brackets the record range with a start and stop timer event', () => {
    // A record range without a start/stop pair is a common cause of intervals.icu
    // importing an activity with an empty stream.
    expect(decoded.events).toHaveLength(2);
    expect(decoded.events[0].event).toBe('timer');
    expect(decoded.events[0].eventType).toBe('start');
    expect(decoded.events[1].event).toBe('timer');
    expect(decoded.events[1].eventType).toBe('stop');
  });

  it('reports elapsed time equal to timer time', () => {
    const [s] = decoded.sessions;
    expect(s.totalElapsedTime).toBeCloseTo(session.duration, 3);
    expect(s.totalElapsedTime).toBe(s.totalTimerTime);
  });

  it('sums lap distances back to the session distance within 1 m', () => {
    const [s] = decoded.sessions;
    const lapSum = decoded.laps.reduce((acc, lap) => acc + (lap.totalDistance ?? 0), 0);
    expect(Math.abs(lapSum - (s.totalDistance ?? 0))).toBeLessThanOrEqual(1);
  });

  it('emits one lap per 500 m split (10 for a 5 km row)', () => {
    // buildRealisticSession has ten 500 m splits — the encoder writes one lap
    // per split (`fitEncoderService.ts:249`) so ten laps sum to 5 km exactly.
    expect(decoded.laps).toHaveLength(10);
    expect(decoded.sessions[0].numLaps).toBe(10);
  });

  it('writes record timestamps in monotonically non-decreasing order', () => {
    let prev = -Infinity;
    for (const record of decoded.records) {
      const ts = (record.timestamp as Date).getTime();
      expect(ts).toBeGreaterThanOrEqual(prev);
      prev = ts;
    }
  });

  it('writes positions inside the FIT semicircle range', () => {
    // The FIT spec stores lat/long as int32 semicircles; the SDK decodes them
    // as raw semicircles (integer). Converted to degrees they must land inside
    // [-90, 90] and [-180, 180].
    const maxSemicirclesLat = (90 * 2 ** 31) / 180;
    const maxSemicirclesLng = (180 * 2 ** 31) / 180;
    for (const record of decoded.records) {
      expect(Number.isInteger(record.positionLat)).toBe(true);
      expect(Number.isInteger(record.positionLong)).toBe(true);
      expect(Math.abs(record.positionLat!)).toBeLessThanOrEqual(maxSemicirclesLat);
      expect(Math.abs(record.positionLong!)).toBeLessThanOrEqual(maxSemicirclesLng);
    }
  });

  it('writes heart rate, power and cadence inside their FIT-valid bands', () => {
    for (const record of decoded.records) {
      if (record.heartRate !== undefined) expect(record.heartRate).toBeGreaterThan(0);
      if (record.heartRate !== undefined) expect(record.heartRate).toBeLessThan(255);
      if (record.power !== undefined) expect(record.power).toBeGreaterThanOrEqual(0);
      if (record.power !== undefined) expect(record.power).toBeLessThan(65535);
      if (record.cadence !== undefined) expect(record.cadence).toBeGreaterThanOrEqual(0);
      if (record.cadence !== undefined) expect(record.cadence).toBeLessThan(255);
    }
  });

  it('emits one record per sample (1250)', () => {
    expect(decoded.records).toHaveLength(session.samples.length);
  });
});

describe('FIT fixture byte-for-byte gate (issue #446, AC2)', () => {
  if (UPDATE) {
    it('regenerates the checked-in fixture', () => {
      writeFileSync(FIXTURE_PATH, encoded);
      expect(existsSync(FIXTURE_PATH)).toBe(true);
    });
  } else {
    it('matches the checked-in fixture byte-for-byte', () => {
      expect(existsSync(FIXTURE_PATH)).toBe(true);
      const fixture = readFileSync(FIXTURE_PATH);
      // Compare via Buffer for a clear length-first mismatch message; then
      // compare the payloads with `.equals` to fail loudly on any diff.
      expect(fixture.length).toBe(encoded.length);
      expect(Buffer.from(encoded).equals(fixture)).toBe(true);
    });
  }
});

/**
 * #466 AC10 — two further fixtures covering the polyline edge cases the
 * sampler exercises: a closed loop (where lat/lng wraps modulo the loop
 * length past 1×) and a gate-chain polyline (two vertices, straight line).
 * Both are regenerable with the same `UPDATE_FIT_FIXTURE=1` env var and
 * both are validated by `scripts/run-fit-csv-check.mjs` alongside the
 * realistic session fixture.
 */
describe('loop-route FIT fixture (issue #466, AC10 / FR4)', () => {
  const session = buildLoopRouteSession();
  const bytes = encodeSession(session);
  const decoded = decode(bytes);

  it('rows for 1.5× the loop length, so the sampler wraps modulo the loop', () => {
    const loopMetres = cumulativeLengths(LOOP_ROUTE).at(-1)!;
    expect(session.distance).toBeGreaterThan(loopMetres);
    expect(session.distance).toBeLessThan(loopMetres * 2);
  });

  it('decodes as a valid rowing Activity', () => {
    expect(decoded.fileIds[0].type).toBe('activity');
    expect(decoded.sessions[0].sport).toBe('rowing');
  });

  it('keeps every record position inside the loop route bounding box', () => {
    const lats = LOOP_ROUTE.map((c) => c.lat);
    const lngs = LOOP_ROUTE.map((c) => c.lng);
    const toSemicircles = (degrees: number) => (degrees * 2 ** 31) / 180;
    const minLat = toSemicircles(Math.min(...lats));
    const maxLat = toSemicircles(Math.max(...lats));
    const minLng = toSemicircles(Math.min(...lngs));
    const maxLng = toSemicircles(Math.max(...lngs));
    for (const record of decoded.records) {
      expect(record.positionLat!).toBeGreaterThanOrEqual(minLat - 1);
      expect(record.positionLat!).toBeLessThanOrEqual(maxLat + 1);
      expect(record.positionLong!).toBeGreaterThanOrEqual(minLng - 1);
      expect(record.positionLong!).toBeLessThanOrEqual(maxLng + 1);
    }
  });

  if (UPDATE) {
    it('regenerates the loop-route fixture', () => {
      writeFileSync(LOOP_FIXTURE_PATH, bytes);
    });
  } else {
    it('matches the checked-in loop-route fixture byte-for-byte', () => {
      expect(existsSync(LOOP_FIXTURE_PATH)).toBe(true);
      const fixture = readFileSync(LOOP_FIXTURE_PATH);
      expect(fixture.length).toBe(bytes.length);
      expect(Buffer.from(bytes).equals(fixture)).toBe(true);
    });
  }
});

describe('gate-chain FIT fixture (issue #466, AC10 / FR6)', () => {
  const session = buildGateChainSession();
  const bytes = encodeSession(session);
  const decoded = decode(bytes);

  it('decodes as a valid rowing Activity', () => {
    expect(decoded.fileIds[0].type).toBe('activity');
    expect(decoded.sessions[0].sport).toBe('rowing');
  });

  it('keeps every record position inside the gate-chain bounding box', () => {
    const lats = GATE_CHAIN_ROUTE.map((c) => c.lat);
    const lngs = GATE_CHAIN_ROUTE.map((c) => c.lng);
    const toSemicircles = (degrees: number) => (degrees * 2 ** 31) / 180;
    const minLat = toSemicircles(Math.min(...lats));
    const maxLat = toSemicircles(Math.max(...lats));
    const minLng = toSemicircles(Math.min(...lngs));
    const maxLng = toSemicircles(Math.max(...lngs));
    for (const record of decoded.records) {
      expect(record.positionLat!).toBeGreaterThanOrEqual(minLat - 1);
      expect(record.positionLat!).toBeLessThanOrEqual(maxLat + 1);
      expect(record.positionLong!).toBeGreaterThanOrEqual(minLng - 1);
      expect(record.positionLong!).toBeLessThanOrEqual(maxLng + 1);
    }
  });

  if (UPDATE) {
    it('regenerates the gate-chain fixture', () => {
      writeFileSync(GATE_CHAIN_FIXTURE_PATH, bytes);
    });
  } else {
    it('matches the checked-in gate-chain fixture byte-for-byte', () => {
      expect(existsSync(GATE_CHAIN_FIXTURE_PATH)).toBe(true);
      const fixture = readFileSync(GATE_CHAIN_FIXTURE_PATH);
      expect(fixture.length).toBe(bytes.length);
      expect(Buffer.from(bytes).equals(fixture)).toBe(true);
    });
  }
});
