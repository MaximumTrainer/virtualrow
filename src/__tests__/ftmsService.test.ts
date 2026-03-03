import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FTMSBluetoothService } from '../services/ftmsService';

// Build a Rowing Machine Data DataView with the given fields.
// flags: 16-bit little-endian bitmask (see FTMS spec 0x2AD1)
function buildRowingData(options: {
  strokeRate?: number;    // actual spm (will be encoded as spm*2 per spec)
  strokeCount?: number;
  totalDistance?: number; // meters
  instPace?: number;      // seconds per 500m (will be encoded as *10)
  avgPace?: number;
  instPower?: number;     // watts
  avgPower?: number;
  calories?: number;      // kJ total
  heartRate?: number;     // bpm
  elapsedTime?: number;   // seconds
}): DataView {
  // Build flags
  let flags = 0;
  const hasStrokeRate = options.strokeRate !== undefined || options.strokeCount !== undefined;
  // Bit 0 = More Data (0 means stroke rate/count ARE present)
  if (!hasStrokeRate) flags |= 0x0001; // set More Data = 1 to omit stroke fields
  if (options.instPace !== undefined)  flags |= 0x0008;
  if (options.avgPace !== undefined)   flags |= 0x0010;
  if (options.instPower !== undefined) flags |= 0x0020;
  if (options.avgPower !== undefined)  flags |= 0x0040;
  if (options.totalDistance !== undefined) flags |= 0x0004;
  if (options.calories !== undefined)  flags |= 0x0100;
  if (options.heartRate !== undefined) flags |= 0x0200;
  if (options.elapsedTime !== undefined) flags |= 0x0800;

  // Calculate required buffer size
  let size = 2; // flags (uint16)
  if (hasStrokeRate) size += 3; // stroke rate (uint8) + stroke count (uint16)
  if (options.totalDistance !== undefined) size += 3; // uint24
  if (options.instPace !== undefined) size += 2;
  if (options.avgPace !== undefined) size += 2;
  if (options.instPower !== undefined) size += 2;
  if (options.avgPower !== undefined) size += 2;
  if (options.calories !== undefined) size += 5; // total(2) + per_hour(2) + per_min(1)
  if (options.heartRate !== undefined) size += 1;
  if (options.elapsedTime !== undefined) size += 2;

  const buf = new ArrayBuffer(size);
  const view = new DataView(buf);
  let offset = 0;

  view.setUint16(offset, flags, true);
  offset += 2;

  if (hasStrokeRate) {
    // Stroke rate encoded as actual_spm * 2 (resolution 0.5/min)
    view.setUint8(offset, (options.strokeRate ?? 0) * 2);
    offset += 1;
    view.setUint16(offset, options.strokeCount ?? 0, true);
    offset += 2;
  }

  if (options.totalDistance !== undefined) {
    view.setUint16(offset, options.totalDistance & 0xffff, true);
    view.setUint8(offset + 2, (options.totalDistance >> 16) & 0xff);
    offset += 3;
  }

  if (options.instPace !== undefined) {
    view.setUint16(offset, Math.round(options.instPace * 10), true);
    offset += 2;
  }

  if (options.avgPace !== undefined) {
    view.setUint16(offset, Math.round(options.avgPace * 10), true);
    offset += 2;
  }

  if (options.instPower !== undefined) {
    view.setInt16(offset, options.instPower, true);
    offset += 2;
  }

  if (options.avgPower !== undefined) {
    view.setInt16(offset, options.avgPower, true);
    offset += 2;
  }

  if (options.calories !== undefined) {
    view.setUint16(offset, options.calories, true);     // total kJ
    view.setUint16(offset + 2, 0, true);               // per hour (unused)
    view.setUint8(offset + 4, 0);                      // per min (unused)
    offset += 5;
  }

  if (options.heartRate !== undefined) {
    view.setUint8(offset, options.heartRate);
    offset += 1;
  }

  if (options.elapsedTime !== undefined) {
    view.setUint16(offset, options.elapsedTime, true);
    offset += 2;
  }

  return view;
}

describe('FTMSBluetoothService', () => {
  let svc: FTMSBluetoothService;

  beforeEach(() => {
    svc = new FTMSBluetoothService();
  });

  it('initial state is disconnected with zeroed data', () => {
    expect(svc.isConnected()).toBe(false);
    const data = svc.getRowingData();
    expect(data.distance).toBe(0);
    expect(data.elapsedTime).toBe(0);
  });

  it('parses stroke rate and stroke count when More Data bit is 0', () => {
    const listener = vi.fn();
    svc.on('data', listener);

    const view = buildRowingData({ strokeRate: 24, strokeCount: 100 });
    svc.parseRowingData(view);

    expect(listener).toHaveBeenCalled();
    const emitted = listener.mock.calls[0][0];
    expect(emitted.cadence).toBe(24);
  });

  it('omits stroke fields when More Data bit is 1', () => {
    const listener = vi.fn();
    svc.on('data', listener);

    // No strokeRate / strokeCount → More Data bit set → no stroke fields emitted
    const view = buildRowingData({ instPace: 120.5 });
    svc.parseRowingData(view);

    const emitted = listener.mock.calls[0][0];
    // cadence should remain at its initial value (0) because no stroke field was present
    expect(emitted.cadence).toBe(0);
    expect(emitted.pace).toBeCloseTo(120.5, 1);
  });

  it('parses total distance (uint24)', () => {
    const listener = vi.fn();
    svc.on('data', listener);

    const view = buildRowingData({ strokeRate: 20, totalDistance: 2500 });
    svc.parseRowingData(view);

    expect(listener.mock.calls[0][0].distance).toBe(2500);
  });

  it('parses instantaneous pace and converts from 1/10s units', () => {
    const listener = vi.fn();
    svc.on('data', listener);

    const view = buildRowingData({ strokeRate: 20, instPace: 96.4 });
    svc.parseRowingData(view);

    expect(listener.mock.calls[0][0].pace).toBeCloseTo(96.4, 1);
  });

  it('uses average pace when instantaneous pace is absent', () => {
    const listener = vi.fn();
    svc.on('data', listener);

    const view = buildRowingData({ strokeRate: 20, avgPace: 102.0 });
    svc.parseRowingData(view);

    expect(listener.mock.calls[0][0].pace).toBeCloseTo(102.0, 1);
  });

  it('parses instantaneous power', () => {
    const listener = vi.fn();
    svc.on('data', listener);

    const view = buildRowingData({ strokeRate: 20, instPower: 180 });
    svc.parseRowingData(view);

    expect(listener.mock.calls[0][0].power).toBe(180);
  });

  it('uses average power when instantaneous power is absent', () => {
    const listener = vi.fn();
    svc.on('data', listener);

    const view = buildRowingData({ strokeRate: 20, avgPower: 165 });
    svc.parseRowingData(view);

    expect(listener.mock.calls[0][0].power).toBe(165);
  });

  it('parses expended energy (calories)', () => {
    const listener = vi.fn();
    svc.on('data', listener);

    const view = buildRowingData({ strokeRate: 20, calories: 320 });
    svc.parseRowingData(view);

    expect(listener.mock.calls[0][0].calories).toBe(320);
  });

  it('parses heart rate', () => {
    const listener = vi.fn();
    svc.on('data', listener);

    const view = buildRowingData({ strokeRate: 20, heartRate: 145 });
    svc.parseRowingData(view);

    expect(listener.mock.calls[0][0].heartRate).toBe(145);
  });

  it('parses elapsed time and converts seconds to milliseconds', () => {
    const listener = vi.fn();
    svc.on('data', listener);

    const view = buildRowingData({ strokeRate: 20, elapsedTime: 300 });
    svc.parseRowingData(view);

    expect(listener.mock.calls[0][0].elapsedTime).toBe(300_000);
  });

  it('parses a full packet with all fields', () => {
    const listener = vi.fn();
    svc.on('data', listener);

    const view = buildRowingData({
      strokeRate: 28,
      strokeCount: 200,
      totalDistance: 1000,
      instPace: 110.0,
      instPower: 200,
      calories: 250,
      heartRate: 155,
      elapsedTime: 600,
    });
    svc.parseRowingData(view);

    const d = listener.mock.calls[0][0];
    expect(d.cadence).toBe(28);
    expect(d.distance).toBe(1000);
    expect(d.pace).toBeCloseTo(110.0, 1);
    expect(d.power).toBe(200);
    expect(d.calories).toBe(250);
    expect(d.heartRate).toBe(155);
    expect(d.elapsedTime).toBe(600_000);
  });

  it('ignores packets shorter than 2 bytes', () => {
    const listener = vi.fn();
    svc.on('data', listener);

    const view = new DataView(new ArrayBuffer(1));
    svc.parseRowingData(view);

    expect(listener).not.toHaveBeenCalled();
  });

  it('accumulates data across multiple packets', () => {
    const listener = vi.fn();
    svc.on('data', listener);

    svc.parseRowingData(buildRowingData({ strokeRate: 20, totalDistance: 500 }));
    svc.parseRowingData(buildRowingData({ strokeRate: 22, totalDistance: 1000 }));

    const latest = svc.getRowingData();
    expect(latest.distance).toBe(1000);
    expect(latest.cadence).toBe(22);
  });

  it('emits connected event on successful connect', async () => {
    const mockDevice = {
      name: 'FTMS Rower Test',
      gatt: {
        connect: vi.fn().mockResolvedValue({
          getPrimaryService: vi.fn().mockResolvedValue({
            getCharacteristic: vi.fn().mockResolvedValue({
              startNotifications: vi.fn().mockResolvedValue(undefined),
              addEventListener: vi.fn(),
            }),
          }),
        }),
        connected: false,
      },
      addEventListener: vi.fn(),
    };

    (globalThis as any).navigator = {
      bluetooth: {
        requestDevice: vi.fn().mockResolvedValue(mockDevice),
      },
    };

    const connectedListener = vi.fn();
    svc.on('connected', connectedListener);

    const result = await svc.connect();
    expect(result).toBe(true);
    expect(connectedListener).toHaveBeenCalledWith({ deviceName: 'FTMS Rower Test' });
  });

  it('emits error event when Web Bluetooth is unavailable', async () => {
    (globalThis as any).navigator = {};

    const errorListener = vi.fn();
    svc.on('error', errorListener);

    const result = await svc.connect();
    expect(result).toBe(false);
    expect(errorListener).toHaveBeenCalled();
  });
});
