import { describe, it, expect, vi } from 'vitest';
import { HeartRateBluetoothService } from '../services/heartRateBluetoothService';

// Helper to build a Heart Rate Measurement notification DataView
function buildHRMeasurement(bpm: number, useUint16 = false) {
  // Flags: bit0 indicates uint16 format
  const buffer = new ArrayBuffer(useUint16 ? 3 : 2);
  const view = new DataView(buffer);
  view.setUint8(0, useUint16 ? 0x01 : 0x00);
  if (useUint16) {
    view.setUint16(1, bpm, true);
  } else {
    view.setUint8(1, bpm);
  }
  return view;
}

describe('HeartRateBluetoothService', () => {
  it('parses uint8 heart rate measurement notifications', () => {
    const svc = new HeartRateBluetoothService();
    const listener = vi.fn();
    svc.on('heartRate', listener);
    // @ts-expect-error access private for test injection
    svc.handleHRNotification({ target: { value: buildHRMeasurement(72) } } as any);
    expect(listener).toHaveBeenCalled();
    const callArg = listener.mock.calls[0][0];
    expect(callArg.bpm).toBe(72);
  });

  it('parses uint16 heart rate measurement notifications', () => {
    const svc = new HeartRateBluetoothService();
    const listener = vi.fn();
    svc.on('heartRate', listener);
    // inject measurement with uint16 flag and bpm 140
    // @ts-expect-error private access for controlled test
    svc.handleHRNotification({ target: { value: buildHRMeasurement(140, true) } } as any);
    expect(listener).toHaveBeenCalled();
    expect(listener.mock.calls[0][0].bpm).toBe(140);
  });

  it('stores samples and enforces length cap', () => {
    const svc = new HeartRateBluetoothService();
    for (let i = 0; i < 10; i++) {
      // @ts-expect-error private access
      svc.handleHRNotification({ target: { value: buildHRMeasurement(60 + i) } } as any);
    }
    expect(svc.getSamples().length).toBe(10);
    // exceed cap artificially
    for (let i = 0; i < 1300; i++) {
      // @ts-expect-error private access
      svc.handleHRNotification({ target: { value: buildHRMeasurement(80) } } as any);
    }
    expect(svc.getSamples().length).toBeLessThanOrEqual(1200);
  });
});
