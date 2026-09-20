/**
 * One unit for power, produced by every device path (#306).
 *
 * `PM5Data.power` is watts. The FTMS adapter parses it; the PM5 adapter did
 * not, so a rower on a Concept2 saw **0 W** on the Power card for a whole
 * session and **Avg Power 0 W** in the summary — on a row where they held a
 * steady 180 W. It reached the FIT export and the intervals.icu upload too, so
 * a PM5 session uploaded with no power at all.
 *
 * `bluetoothService.ts` read `data.averagePower`, and nothing in the vendored
 * wrapper ever emitted a field by that or any other name. The wrapper had no
 * listener and no parser for the characteristic power actually arrives on.
 *
 * The wire formats differ and that is fine — translating them is what an
 * adapter is for. What must not differ is what comes out.
 *
 * The PM5 layout below is not invented: it is `_extractAdditionalStrokeData`
 * from ergarcade/pm5-base `lib/pm5-ble.js`, the upstream this file's vendor
 * copy was adapted from. `strokePower` is a plain little-endian uint16 of watts
 * at bytes 3-4 of characteristic 0xce060036, with no multiplier.
 */

import { describe, it, expect } from 'vitest';
import PM5 from '../vendor/pm5-base.js';
import { FTMSBluetoothService } from '../services/ftmsBluetoothService';

/** A number a club rower holds and would notice the absence of. */
const STEADY_WATTS = 180;

const u16le = (value: number): [number, number] => [value & 0xff, (value >> 8) & 0xff];

/**
 * An Additional Stroke Data frame (0xce060036), as the PM5 sends one.
 *
 * 0-2 elapsed time (centiseconds), 3-4 stroke power (watts), 5-6 caloric burn
 * rate, 7-8 stroke count, 9-11 projected work time, 12-14 projected work
 * distance, 15-17 projected work other.
 */
function buildAdditionalStrokeData(watts: number, elapsedSeconds = 60): DataView {
  const buf = new ArrayBuffer(18);
  const v = new Uint8Array(buf);
  const cs = Math.round(elapsedSeconds * 100);
  v[0] = cs & 0xff;
  v[1] = (cs >> 8) & 0xff;
  v[2] = (cs >> 16) & 0xff;
  [v[3], v[4]] = u16le(watts);
  [v[5], v[6]] = u16le(700); // caloric burn rate, so the neighbours are not zero
  [v[7], v[8]] = u16le(42); // stroke count
  return new DataView(buf);
}

function buildRowerData(flags: number, bytes: number[]): DataView {
  const buf = new ArrayBuffer(2 + bytes.length);
  const view = new DataView(buf);
  view.setUint16(0, flags, true);
  bytes.forEach((b, i) => view.setUint8(2 + i, b));
  return view;
}

/** Drive a frame through the vendor parser the way a notification would. */
function extractStrokeData(frame: DataView): Record<string, number> {
  const monitor = new PM5(
    () => {},
    () => {},
    () => {},
    () => {},
  ) as unknown as {
    _extractAdditionalStrokeData: (e: { target: { value: DataView } }) => Record<string, number>;
  };
  return monitor._extractAdditionalStrokeData({ target: { value: frame } });
}

describe('power means the same thing whichever rower is connected (#306)', () => {
  it('reads PM5 stroke power out of the frame it actually arrives on', () => {
    const data = extractStrokeData(buildAdditionalStrokeData(STEADY_WATTS));

    expect(data.strokePower, 'PM5 stroke power was not parsed').toBe(STEADY_WATTS);
  });

  it('reads PM5 power in watts, with no multiplier applied', () => {
    // The field the wrapper used to be asked for - averagePower - never
    // existed, so a scaling error here would read as plausibly-wrong watts
    // rather than as an obvious zero. Two values, so a factor cannot hide.
    expect(extractStrokeData(buildAdditionalStrokeData(1)).strokePower).toBe(1);
    expect(extractStrokeData(buildAdditionalStrokeData(999)).strokePower).toBe(999);
  });

  it('reads the elapsed time from the same frame in seconds', () => {
    // Proves the offsets are aligned: if power were read one byte out, this
    // would still pass and the power assertions above would not.
    const data = extractStrokeData(buildAdditionalStrokeData(STEADY_WATTS, 90));

    expect(data.elapsedTime).toBeCloseTo(90, 5);
  });

  it('FTMS reports the same watts from its own wire format', () => {
    const service = new FTMSBluetoothService();
    // flags: no basic data (bit 0), instantaneous power present (bit 5 = 0x0020).
    // Bit 6 is *average* power, which parseRowerData skips past and discards.
    const frame = buildRowerData(0x0001 | 0x0020, u16le(STEADY_WATTS));

    const data = (service as unknown as { parseRowerData: (v: DataView) => { power?: number } })
      .parseRowerData(frame);

    expect(data.power, 'FTMS power is not in watts').toBe(STEADY_WATTS);
  });

  it('agrees with the PM5 path, which is the whole point', () => {
    const service = new FTMSBluetoothService();
    const ftms = (service as unknown as { parseRowerData: (v: DataView) => { power?: number } })
      .parseRowerData(buildRowerData(0x0001 | 0x0020, u16le(STEADY_WATTS)));
    const pm5 = extractStrokeData(buildAdditionalStrokeData(STEADY_WATTS));

    expect(pm5.strokePower).toBe(ftms.power);
  });
});
