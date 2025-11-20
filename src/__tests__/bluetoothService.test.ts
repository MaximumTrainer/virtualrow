import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Concept2BluetoothService } from '../services/bluetoothService';

// Mock the PM5 class from pm5-base
vi.mock('../vendor/pm5-base.js', () => {
  return {
    default: class MockPM5 {
      device: any;
      _connected: boolean = false;
      private callbacks: any;

      constructor(cb_connecting: any, cb_connected: any, cb_disconnected: any, cb_message: any) {
        this.callbacks = { cb_connecting, cb_connected, cb_disconnected, cb_message };
      }

      async doConnect() {
        this.callbacks.cb_connecting?.();
        this.device = { name: 'PM5-TEST' };
        this._connected = true;
        this.callbacks.cb_connected?.();
        return true;
      }

      async doDisconnect() {
        this._connected = false;
        this.callbacks.cb_disconnected?.();
      }

      connected() {
        return this._connected;
      }

      async addEventListener(_type: string, _callback: any) {
        // Mock event listener registration
      }

      async writeTransmit(_data: any) {
        return true;
      }

      async _getCharacteristic(_config: any) {
        return {
          writeValue: vi.fn().mockResolvedValue(undefined),
        };
      }
    }
  };
});

describe('Concept2BluetoothService basic behavior', () => {
  beforeEach(() => {
    // Mock navigator.bluetooth
    (globalThis as any).navigator = {
      bluetooth: {
        requestDevice: vi.fn(),
      },
    };
  });

  it('initial state is disconnected with zeroed data', () => {
    const svc = new Concept2BluetoothService();
    expect(svc.isConnected()).toBe(false);
    const data = svc.getPM5Data();
    expect(data.distance).toBe(0);
    expect(data.pace).toBe(0);
  });

  it('connects with mocked navigator.bluetooth', async () => {
    const svc = new Concept2BluetoothService();
    const ok = await svc.connect();
    expect(ok).toBe(true);
    expect(svc.isConnected()).toBe(true);
  });
});
