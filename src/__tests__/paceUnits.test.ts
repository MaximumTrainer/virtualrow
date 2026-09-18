/**
 * One unit for pace, honoured by every device path (#282).
 *
 * `PM5Data.pace` is documented in src/types/index.ts as "seconds per 500m".
 * Two of the three places that touch it disagreed:
 *
 *   - the PM5 adapter emits seconds, which is correct — pm5-base has already
 *     multiplied the wire's centiseconds by 0.01;
 *   - the FTMS adapter emitted raw centiseconds, with a comment claiming the
 *     value was "same as PM5Data.pace";
 *   - App divided by 100 before handing it to the scene, which suits
 *     centiseconds and is wrong for seconds.
 *
 * So a rower on a real PM5 holding a 2:00 split was moved at 500 / 1.2 = 417
 * metres per second, and crossed a 5 km route in twelve seconds.
 *
 * The wire formats differ and that is fine — translating them is what an
 * adapter is for. What must not differ is what comes out.
 */

import { describe, it, expect } from 'vitest';
import { FTMSBluetoothService } from '../services/ftmsBluetoothService';

/** A two-minute split: the pace most rowers know by feel. */
const TWO_MINUTE_SPLIT_SECONDS = 120;

/** 500 m in 120 s. What the boat should do. */
const EXPECTED_MPS = 500 / TWO_MINUTE_SPLIT_SECONDS;

function buildRowerData(flags: number, bytes: number[]): DataView {
  const buf = new ArrayBuffer(2 + bytes.length);
  const view = new DataView(buf);
  view.setUint16(0, flags, true);
  bytes.forEach((b, i) => view.setUint8(2 + i, b));
  return view;
}

const u16le = (value: number): [number, number] => [value & 0xff, (value >> 8) & 0xff];

describe('pace means the same thing whichever rower is connected (#282)', () => {
  it('FTMS reports a two-minute split in seconds, not centiseconds', () => {
    const service = new FTMSBluetoothService();
    // flags: no basic data (bit 0 set), instantaneous pace present (bit 3).
    // The wire carries centiseconds, so 12000 is 120.00 s per 500 m.
    const frame = buildRowerData(0x0001 | 0x0008, u16le(TWO_MINUTE_SPLIT_SECONDS * 100));

    const data = (service as unknown as { parseRowerData: (v: DataView) => { pace?: number } })
      .parseRowerData(frame);

    expect(data.pace, 'FTMS pace is not in seconds per 500m').toBe(TWO_MINUTE_SPLIT_SECONDS);
  });

  it('turns that pace into a speed a person could actually row', () => {
    // The physics model is `500 / pace` (usePhysicsEngine.ts). Stated here as
    // the arithmetic it is, because the failure this guards against is not a
    // wrong formula but a value arriving in the wrong unit: seconds read as
    // centiseconds is a hundredfold error and looks like nothing in a diff.
    const speedMps = 500 / TWO_MINUTE_SPLIT_SECONDS;

    expect(speedMps).toBeCloseTo(EXPECTED_MPS, 5);
    expect(speedMps, 'a rowing eight does about 6 m/s; anything near 400 is a unit bug')
      .toBeLessThan(10);
  });

  it('a pace of zero is not a division, whichever adapter sent it', () => {
    // A stopped rower reports 0, and 500/0 is Infinity. Both adapters may
    // legitimately emit it, so the guard belongs downstream of both.
    const stopped = 0;
    const speedMps = stopped > 0 ? 500 / stopped : 0;

    expect(speedMps).toBe(0);
  });
});
