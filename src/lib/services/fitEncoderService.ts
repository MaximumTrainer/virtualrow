/**
 * A binary FIT Activity encoder (issue #221, R2).
 *
 * Hand-written rather than taken from `@garmin/fitsdk`, whose licence is
 * Garmin's own rather than an OSI one (P2.1). The SDK is a devDependency and
 * only its `Decoder` is used, by the round-trip test that gates this file — so
 * the encoder is checked against an independent reader without any non-OSI
 * code entering the bundle.
 *
 * Reached through a dynamic `import()` (P2.2), so none of this is in the main
 * chunk.
 *
 * Message order is the one intervals.icu expects of an activity file:
 *   fileId → event(timer start) → record… → event(timer stop) → lap… → session → activity
 *
 * The `route` the acceptance criteria name is not a parameter: R1 already
 * projects each sample onto the route polyline, so a sample carries its own
 * position and the encoder needs nothing beyond the session.
 */
import type { ActivitySample, Split, WorkoutSession } from '../types/index';
import { sessionIdToSerialNumber } from '../utils/exporters';

/** Seconds between the Unix epoch and the FIT epoch, 1989-12-31T00:00:00Z. */
export const FIT_EPOCH_OFFSET_SECONDS = 631065600;

const SEMICIRCLES_PER_DEGREE = 2 ** 31 / 180;
const METERS_PER_SPLIT = 500;

/** Global message numbers, from the FIT profile. */
const MESG = { fileId: 0, session: 18, lap: 19, record: 20, event: 21, activity: 34 } as const;

/** Enumerated field values used below, from the FIT profile's type tables. */
const FILE_TYPE_ACTIVITY = 4;
const MANUFACTURER_DEVELOPMENT = 255;
const SPORT_ROWING = 15;
const SUB_SPORT_INDOOR_ROWING = 14;
const EVENT_TIMER = 0;
const EVENT_LAP = 9;
const EVENT_SESSION = 8;
const EVENT_ACTIVITY = 26;
const EVENT_TYPE_START = 0;
const EVENT_TYPE_STOP = 1;
const ACTIVITY_TYPE_MANUAL = 0;

/**
 * FIT base types: the wire encoding of a field, and the sentinel a reader
 * treats as "this field was not recorded".
 */
const BASE = {
  enum: { id: 0x00, size: 1, invalid: 0xff },
  uint8: { id: 0x02, size: 1, invalid: 0xff },
  uint16: { id: 0x84, size: 2, invalid: 0xffff },
  sint32: { id: 0x85, size: 4, invalid: 0x7fffffff },
  uint32: { id: 0x86, size: 4, invalid: 0xffffffff },
  uint32z: { id: 0x8c, size: 4, invalid: 0 },
} as const;

type BaseType = (typeof BASE)[keyof typeof BASE];

/** One field of a message: its profile number, wire type, and scale. */
interface FieldSpec {
  num: number;
  type: BaseType;
  /** Stored value is `value * scale`, per the FIT profile. */
  scale?: number;
}

/** A row of values, positionally matching a field list. */
type Row = Array<number | undefined>;

/** A message ready to write: its definition and one row of values per record. */
interface MessageSet {
  globalNum: number;
  fields: FieldSpec[];
  rows: Row[];
}

// ── Byte assembly ───────────────────────────────────────────────────────────

/** A growable little-endian byte sink. */
class ByteWriter {
  private bytes: number[] = [];

  push(...values: number[]): void {
    this.bytes.push(...values);
  }

  /** Write `value` as `size` little-endian bytes. */
  pushInt(value: number, size: number): void {
    // Wrap into the unsigned range first, so sint32 two's-complement falls out.
    let remaining = value < 0 ? value + 2 ** (size * 8) : value;
    for (let i = 0; i < size; i++) {
      this.bytes.push(remaining & 0xff);
      remaining = Math.floor(remaining / 256);
    }
  }

  toUint8Array(): Uint8Array {
    return Uint8Array.from(this.bytes);
  }
}

/** Nibble table for the FIT CRC-16, as specified in the FIT protocol document. */
const CRC_TABLE = [
  0x0000, 0xcc01, 0xd801, 0x1400, 0xf001, 0x3c00, 0x2800, 0xe401,
  0xa001, 0x6c00, 0x7800, 0xb401, 0x5000, 0x9c01, 0x8801, 0x4400,
];

function fitCrc(bytes: Uint8Array): number {
  let crc = 0;
  for (const byte of bytes) {
    for (const nibble of [byte & 0x0f, (byte >> 4) & 0x0f]) {
      const carry = CRC_TABLE[crc & 0x0f];
      crc = ((crc >> 4) & 0x0fff) ^ carry ^ CRC_TABLE[nibble];
    }
  }
  return crc;
}

// ── Value conversion ────────────────────────────────────────────────────────

function toFitTimestamp(date: Date): number {
  return Math.round(date.getTime() / 1000) - FIT_EPOCH_OFFSET_SECONDS;
}

function toSemicircles(degrees: number | undefined): number | undefined {
  return degrees === undefined ? undefined : Math.round(degrees * SEMICIRCLES_PER_DEGREE);
}

/** Boat speed in m/s from a 500 m split pace. A zero or missing pace is no speed. */
function speedFromPace(paceSecondsPer500m: number | undefined): number | undefined {
  if (!paceSecondsPer500m || paceSecondsPer500m <= 0) return undefined;
  return 500 / paceSecondsPer500m;
}

function averageOf(
  samples: ActivitySample[],
  pick: (sample: ActivitySample) => number | undefined,
): number | undefined {
  const values = samples.map(pick).filter((value): value is number => value !== undefined);
  if (values.length === 0) return undefined;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

// ── Message writing ─────────────────────────────────────────────────────────

/**
 * Write one message set: a definition message, then its data messages.
 *
 * Every set gets local message type 0, re-defined each time. A FIT file may
 * interleave up to 16 local types, but this encoder writes each kind of
 * message in one contiguous run, so one slot is all it needs.
 */
function writeMessageSet(writer: ByteWriter, set: MessageSet): void {
  writer.push(0x40); // definition message, local type 0
  writer.push(0x00); // reserved
  writer.push(0x00); // little-endian architecture
  writer.pushInt(set.globalNum, 2);
  writer.push(set.fields.length);
  for (const field of set.fields) {
    writer.push(field.num, field.type.size, field.type.id);
  }

  for (const row of set.rows) {
    writer.push(0x00); // data message, local type 0
    row.forEach((value, i) => {
      const { type, scale } = set.fields[i];
      const stored = value === undefined ? type.invalid : Math.round(value * (scale ?? 1));
      writer.pushInt(stored, type.size);
    });
  }
}

/**
 * Drop the fields no row actually carries.
 *
 * A field every row left empty is removed from the definition altogether, so a
 * row with no strap describes no heart-rate field at all rather than a column
 * of invalid sentinels (AC2.5). Gaps within a retained field still write the
 * sentinel, which a reader reports as absent rather than as zero.
 */
function withoutEmptyFields(fields: FieldSpec[], rows: Row[]): { fields: FieldSpec[]; rows: Row[] } {
  const kept = fields
    .map((field, i) => ({ field, i }))
    .filter(({ i }) => rows.some((row) => row[i] !== undefined));
  return {
    fields: kept.map(({ field }) => field),
    rows: rows.map((row) => kept.map(({ i }) => row[i])),
  };
}

function buildRecords(samples: ActivitySample[], startTime: Date): MessageSet {
  const fields: FieldSpec[] = [
    { num: 253, type: BASE.uint32 },             // timestamp
    { num: 0, type: BASE.sint32 },               // positionLat
    { num: 1, type: BASE.sint32 },               // positionLong
    { num: 5, type: BASE.uint32, scale: 100 },   // distance
    { num: 3, type: BASE.uint8 },                // heartRate
    { num: 4, type: BASE.uint8 },                // cadence
    { num: 7, type: BASE.uint16 },               // power
    { num: 6, type: BASE.uint16, scale: 1000 },  // speed
  ];
  const rows: Row[] = samples.map((sample) => [
    toFitTimestamp(new Date(startTime.getTime() + sample.t * 1000)),
    toSemicircles(sample.lat),
    toSemicircles(sample.lng),
    sample.distance,
    sample.heartRate,
    sample.cadence,
    sample.power,
    speedFromPace(sample.pace),
  ]);
  return { globalNum: MESG.record, ...withoutEmptyFields(fields, rows) };
}

/** What one lap covers: a 500 m split, or the whole row when none was reached. */
interface Lap {
  endTime: Date;
  elapsedSeconds: number;
  distance: number;
  pace?: number;
  power?: number;
  heartRate?: number;
}

/**
 * One lap per 500 m split (AC2.6), so intervals.icu shows the splits the app
 * does. A row that never reached 500 m still gets a single lap covering it,
 * rather than decoding as an activity with no structure at all.
 */
function buildLaps(session: WorkoutSession): Lap[] {
  if (session.splits.length === 0) {
    return [{
      endTime: session.endTime ?? new Date(session.startTime.getTime() + session.duration * 1000),
      elapsedSeconds: session.duration,
      distance: session.distance,
      pace: session.averagePace || undefined,
      heartRate: session.heartRateAvg,
    }];
  }

  let previousTime = 0;
  return session.splits.map((split: Split) => {
    const elapsedSeconds = split.time - previousTime;
    previousTime = split.time;
    return {
      endTime: new Date(session.startTime.getTime() + split.time * 1000),
      elapsedSeconds,
      distance: METERS_PER_SPLIT,
      pace: split.pace || undefined,
      power: split.power,
      heartRate: split.heartRate,
    };
  });
}

function buildLapMessages(laps: Lap[], startTime: Date): MessageSet {
  const fields: FieldSpec[] = [
    { num: 254, type: BASE.uint16 },              // messageIndex
    { num: 253, type: BASE.uint32 },              // timestamp
    { num: 2, type: BASE.uint32 },                // startTime
    { num: 0, type: BASE.enum },                  // event
    { num: 1, type: BASE.enum },                  // eventType
    { num: 7, type: BASE.uint32, scale: 1000 },   // totalElapsedTime
    { num: 8, type: BASE.uint32, scale: 1000 },   // totalTimerTime
    { num: 9, type: BASE.uint32, scale: 100 },    // totalDistance
    { num: 13, type: BASE.uint16, scale: 1000 },  // avgSpeed
    { num: 15, type: BASE.uint8 },                // avgHeartRate
    { num: 19, type: BASE.uint16 },               // avgPower
    { num: 25, type: BASE.enum },                 // sport
    { num: 39, type: BASE.enum },                 // subSport
  ];

  let lapStart = startTime;
  const rows: Row[] = laps.map((lap, index) => {
    const row: Row = [
      index,
      toFitTimestamp(lap.endTime),
      toFitTimestamp(lapStart),
      EVENT_LAP,
      EVENT_TYPE_STOP,
      lap.elapsedSeconds,
      lap.elapsedSeconds,
      lap.distance,
      speedFromPace(lap.pace),
      lap.heartRate,
      lap.power,
      SPORT_ROWING,
      SUB_SPORT_INDOOR_ROWING,
    ];
    lapStart = lap.endTime;
    return row;
  });
  return { globalNum: MESG.lap, ...withoutEmptyFields(fields, rows) };
}

function buildSessionMessage(session: WorkoutSession, start: Date, end: Date, lapCount: number): MessageSet {
  return {
    globalNum: MESG.session,
    fields: [
      { num: 254, type: BASE.uint16 },              // messageIndex
      { num: 253, type: BASE.uint32 },              // timestamp
      { num: 2, type: BASE.uint32 },                // startTime
      { num: 0, type: BASE.enum },                  // event
      { num: 1, type: BASE.enum },                  // eventType
      { num: 5, type: BASE.enum },                  // sport
      { num: 6, type: BASE.enum },                  // subSport
      { num: 7, type: BASE.uint32, scale: 1000 },   // totalElapsedTime
      { num: 8, type: BASE.uint32, scale: 1000 },   // totalTimerTime
      { num: 9, type: BASE.uint32, scale: 100 },    // totalDistance
      { num: 11, type: BASE.uint16 },               // totalCalories
      { num: 14, type: BASE.uint16, scale: 1000 },  // avgSpeed
      { num: 16, type: BASE.uint8 },                // avgHeartRate
      { num: 17, type: BASE.uint8 },                // maxHeartRate
      { num: 18, type: BASE.uint8 },                // avgCadence
      { num: 20, type: BASE.uint16 },               // avgPower
      { num: 25, type: BASE.uint16 },               // firstLapIndex
      { num: 26, type: BASE.uint16 },               // numLaps
    ],
    rows: [[
      0,
      toFitTimestamp(end),
      toFitTimestamp(start),
      EVENT_SESSION,
      EVENT_TYPE_STOP,
      SPORT_ROWING,
      SUB_SPORT_INDOOR_ROWING,
      session.duration,
      session.duration,
      session.distance,
      session.calories || undefined,
      speedFromPace(session.averagePace || undefined),
      session.heartRateAvg,
      session.heartRateMax,
      averageOf(session.samples, (sample) => sample.cadence),
      averageOf(session.samples, (sample) => sample.power),
      0,
      lapCount,
    ]],
  };
}

/**
 * Encode a completed session as a binary FIT Activity file.
 *
 * Pure: given the same session it returns the same bytes, and it touches
 * neither the DOM nor the network (AC2.7).
 */
export function encodeSession(session: WorkoutSession): Uint8Array {
  const start = new Date(session.startTime);
  const end = session.endTime
    ? new Date(session.endTime)
    : new Date(start.getTime() + session.duration * 1000);
  const laps = buildLaps(session);

  const body = new ByteWriter();

  writeMessageSet(body, {
    globalNum: MESG.fileId,
    fields: [
      { num: 0, type: BASE.enum },     // type
      { num: 1, type: BASE.uint16 },   // manufacturer
      { num: 2, type: BASE.uint16 },   // product
      { num: 3, type: BASE.uint32z },  // serialNumber
      { num: 4, type: BASE.uint32 },   // timeCreated
    ],
    rows: [[
      FILE_TYPE_ACTIVITY,
      MANUFACTURER_DEVELOPMENT,
      1,
      sessionIdToSerialNumber(session.id) % 2 ** 32,
      toFitTimestamp(start),
    ]],
  });

  const timerEventFields: FieldSpec[] = [
    { num: 253, type: BASE.uint32 },  // timestamp
    { num: 0, type: BASE.enum },      // event
    { num: 1, type: BASE.enum },      // eventType
  ];
  writeMessageSet(body, {
    globalNum: MESG.event,
    fields: timerEventFields,
    rows: [[toFitTimestamp(start), EVENT_TIMER, EVENT_TYPE_START]],
  });

  if (session.samples.length > 0) {
    writeMessageSet(body, buildRecords(session.samples, start));
  }

  writeMessageSet(body, {
    globalNum: MESG.event,
    fields: timerEventFields,
    rows: [[toFitTimestamp(end), EVENT_TIMER, EVENT_TYPE_STOP]],
  });

  writeMessageSet(body, buildLapMessages(laps, start));
  writeMessageSet(body, buildSessionMessage(session, start, end, laps.length));

  writeMessageSet(body, {
    globalNum: MESG.activity,
    fields: [
      { num: 253, type: BASE.uint32 },             // timestamp
      { num: 0, type: BASE.uint32, scale: 1000 },  // totalTimerTime
      { num: 1, type: BASE.uint16 },               // numSessions
      { num: 2, type: BASE.enum },                 // type
      { num: 3, type: BASE.enum },                 // event
      { num: 4, type: BASE.enum },                 // eventType
    ],
    rows: [[
      toFitTimestamp(end),
      session.duration,
      1,
      ACTIVITY_TYPE_MANUAL,
      EVENT_ACTIVITY,
      EVENT_TYPE_STOP,
    ]],
  });

  return withHeaderAndCrc(body.toUint8Array());
}

/** Prefix the 14-byte header (with its own CRC) and append the file CRC. */
function withHeaderAndCrc(body: Uint8Array): Uint8Array {
  const header = new ByteWriter();
  header.push(14, 0x20);    // header size, protocol version 2.0
  header.pushInt(2189, 2);  // profile version, matching the SDK's 21.89
  header.pushInt(body.length, 4);
  header.push(...Array.from('.FIT', (char) => char.charCodeAt(0)));
  const headerBytes = header.toUint8Array();

  const file = new ByteWriter();
  file.push(...headerBytes);
  file.pushInt(fitCrc(headerBytes), 2);
  file.push(...body);
  file.pushInt(fitCrc(file.toUint8Array()), 2);
  return file.toUint8Array();
}
