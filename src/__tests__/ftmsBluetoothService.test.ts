/**
 * Unit tests for FTMSBluetoothService.parseRowerData()
 *
 * Tests parse the binary FTMS Rower Data Characteristic (UUID 0x2AD1) encoding
 * and verify that the resulting PM5Data values use the correct units.
 *
 * PM5Data unit conventions (must match what PM5 service emits):
 *   pace         – centiseconds per 500 m  (e.g. 12000 = 120.00 s/500m)
 *   distance     – metres
 *   elapsedTime  – seconds
 *   cadence      – strokes per minute
 *   power        – watts
 *   calories     – kcal
 *   heartRate    – bpm
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { FTMSBluetoothService } from '../services/ftmsBluetoothService';

/** Helper: build a DataView with an FTMS Rower Data payload. */
function buildRowerData(params: {
  flags: number;
  bytes: number[];
}): DataView {
  const buf = new ArrayBuffer(2 + params.bytes.length);
  const view = new DataView(buf);
  view.setUint16(0, params.flags, true);
  params.bytes.forEach((b, i) => view.setUint8(2 + i, b));
  return view;
}

/** Write a uint16 LE value into an existing byte array at offset. */
function u16le(value: number): [number, number] {
  return [value & 0xff, (value >> 8) & 0xff];
}

/** Write a uint24 LE value into an existing byte array at offset. */
function u24le(value: number): [number, number, number] {
  return [value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff];
}

let service: FTMSBluetoothService;

beforeEach(() => {
  service = new FTMSBluetoothService();
});

describe('FTMSBluetoothService.parseRowerData – basic data', () => {
  it('parses stroke rate and stroke count (bit 0 = 0)', () => {
    // flags = 0x0000 → "More Data" bit NOT set → stroke rate + count present
    // Stroke rate raw = 44 → 22 spm; Stroke count = 100
    const view = buildRowerData({
      flags: 0x0000,
      bytes: [44, ...u16le(100)],
    });
    const data = service.parseRowerData(view);
    expect(data.cadence).toBe(22);
  });

  it('skips stroke rate and stroke count when bit 0 is set', () => {
    // flags = 0x0001 → "More Data" set → no basic data in this packet
    const view = buildRowerData({ flags: 0x0001, bytes: [] });
    const data = service.parseRowerData(view);
    expect(data.cadence).toBe(0);
    expect(data.distance).toBe(0);
  });

  it('returns last valid data when packet is too short to parse', () => {
    // Claim all fields present but supply no payload bytes
    const view = buildRowerData({ flags: 0x1fff, bytes: [] });
    const data = service.parseRowerData(view);
    // Should return the existing latestData (all zeros on fresh service) without throwing
    expect(data.pace).toBe(0);
  });
});

describe('FTMSBluetoothService.parseRowerData – optional fields', () => {
  it('parses total distance (bit 2)', () => {
    // flags = 0x0001 | 0x0004 → no basic data, has total distance
    // distance = 2500 m
    const view = buildRowerData({
      flags: 0x0005,
      bytes: [...u24le(2500)],
    });
    const data = service.parseRowerData(view);
    expect(data.distance).toBe(2500);
  });

  it('parses instantaneous pace in centiseconds (bit 3)', () => {
    // flags = 0x0001 | 0x0008 → no basic data, has instant pace
    // pace = 12000 centiseconds/500m = 120 s/500m (2:00/500m)
    const view = buildRowerData({
      flags: 0x0009,
      bytes: [...u16le(12000)],
    });
    const data = service.parseRowerData(view);
    expect(data.pace).toBe(12000);
  });

  it('parses instantaneous power in watts (bit 5)', () => {
    // flags = 0x0001 | 0x0020 → no basic data, has instant power
    // power = 180 W
    const view = buildRowerData({
      flags: 0x0021,
      bytes: [180, 0], // sint16 LE = 180
    });
    const data = service.parseRowerData(view);
    expect(data.power).toBe(180);
  });

  it('parses expended energy calories (bit 8)', () => {
    // flags = 0x0001 | 0x0100 → no basic data, has energy
    // total energy = 350 kcal, then 2 dummy bytes for kcal/hr, 1 for kcal/min
    const view = buildRowerData({
      flags: 0x0101,
      bytes: [...u16le(350), ...u16le(0), 0],
    });
    const data = service.parseRowerData(view);
    expect(data.calories).toBe(350);
  });

  it('parses heart rate (bit 9)', () => {
    // flags = 0x0001 | 0x0200 → no basic data, has heart rate
    const view = buildRowerData({
      flags: 0x0201,
      bytes: [152],
    });
    const data = service.parseRowerData(view);
    expect(data.heartRate).toBe(152);
  });

  it('parses elapsed time in seconds (bit 11)', () => {
    // flags = 0x0001 | 0x0800 → no basic data, has elapsed time
    // elapsed = 1800 seconds = 30 minutes
    const view = buildRowerData({
      flags: 0x0801,
      bytes: [...u16le(1800)],
    });
    const data = service.parseRowerData(view);
    expect(data.elapsedTime).toBe(1800);
  });

  it('parses a combined packet with multiple fields', () => {
    // Basic data present (bit 0 = 0) + total distance (bit 2) + instant pace (bit 3)
    //   + elapsed time (bit 11)
    // Stroke rate raw = 40 → 20 spm; stroke count = 50; distance = 1000 m;
    //   pace = 11000 cs; elapsed = 600 s
    const flags = 0x0000 | 0x0004 | 0x0008 | 0x0800; // 0x080C
    const view = buildRowerData({
      flags,
      bytes: [
        40,               // stroke rate raw (÷2 = 20 spm)
        ...u16le(50),     // stroke count
        ...u24le(1000),   // total distance
        ...u16le(11000),  // instant pace (cs/500m)
        ...u16le(600),    // elapsed time (s)
      ],
    });
    const data = service.parseRowerData(view);
    expect(data.cadence).toBe(20);
    expect(data.distance).toBe(1000);
    expect(data.pace).toBe(11000);
    expect(data.elapsedTime).toBe(600);
  });

  it('ignores average stroke rate (bit 1) field without using it as cadence', () => {
    // flags = 0x0000 | 0x0002 → basic data + avg stroke rate
    // stroke rate raw = 40 → 20 spm; stroke count = 10; avg stroke rate raw = 42 → 21 spm
    const view = buildRowerData({
      flags: 0x0002,
      bytes: [40, ...u16le(10), 42],
    });
    const data = service.parseRowerData(view);
    // cadence should come from instantaneous stroke rate, not average
    expect(data.cadence).toBe(20);
  });

  it('accumulates data across multiple packets', () => {
    // First packet: distance only
    const v1 = buildRowerData({ flags: 0x0005, bytes: [...u24le(500)] });
    service.parseRowerData(v1);

    // Second packet: pace only (distance omitted → should retain previous distance)
    const v2 = buildRowerData({ flags: 0x0009, bytes: [...u16le(10500)] });
    const data = service.parseRowerData(v2);

    expect(data.distance).toBe(500);  // retained from first packet
    expect(data.pace).toBe(10500);    // updated from second packet
  });
});
