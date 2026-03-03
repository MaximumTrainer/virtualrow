// FTMS (Fitness Machine Service Profile) Bluetooth service for rowing machines
// Implements the Rowing Machine Data characteristic per Bluetooth SIG specification
import type { PM5Data } from '../types/index';

// FTMS standard Bluetooth SIG service and characteristic UUIDs
export const FTMS_SERVICE_UUID = '00001826-0000-1000-8000-00805f9b34fb';
export const ROWING_MACHINE_DATA_UUID = '00002ad1-0000-1000-8000-00805f9b34fb';
const FITNESS_MACHINE_CONTROL_POINT_UUID = '00002ad9-0000-1000-8000-00805f9b34fb';
const FITNESS_MACHINE_STATUS_UUID = '00002ada-0000-1000-8000-00805f9b34fb';

export class FTMSBluetoothService {
  private device: BluetoothDevice | null = null;
  private server: BluetoothRemoteGATTServer | null = null;
  private rowingDataChar: BluetoothRemoteGATTCharacteristic | null = null;
  private listeners: Map<string, Function[]> = new Map();
  private rowingData: PM5Data = {
    pace: 0,
    distance: 0,
    elapsedTime: 0,
    power: 0,
    cadence: 0,
    heartRate: 0,
    calories: 0,
  };

  async connect(): Promise<boolean> {
    try {
      if (!navigator.bluetooth) {
        throw new Error('Web Bluetooth API not supported in this browser');
      }

      this.device = await navigator.bluetooth.requestDevice({
        filters: [{ services: [FTMS_SERVICE_UUID] }],
        optionalServices: [FITNESS_MACHINE_CONTROL_POINT_UUID, FITNESS_MACHINE_STATUS_UUID],
      });

      this.emit('connecting', {});
      this.device.addEventListener('gattserverdisconnected', () => this.handleDisconnect());

      this.server = (await this.device.gatt?.connect()) ?? null;
      if (!this.server) throw new Error('Failed to connect to GATT server');

      const ftmsService = await this.server.getPrimaryService(FTMS_SERVICE_UUID);
      this.rowingDataChar = await ftmsService.getCharacteristic(ROWING_MACHINE_DATA_UUID);
      await this.rowingDataChar.startNotifications();
      this.rowingDataChar.addEventListener('characteristicvaluechanged', (e) => {
        const char = e.target as unknown as BluetoothRemoteGATTCharacteristic;
        if (char.value) this.parseRowingData(char.value);
      });

      this.emit('connected', { deviceName: this.device.name || 'FTMS Rower' });
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      let userMessage = message;
      if (message.includes('User cancelled')) {
        userMessage = 'Device selection cancelled. Please try again.';
      } else if (message.includes('No Services matching UUID')) {
        userMessage =
          'FTMS service not found. Ensure your rowing machine is powered on and nearby.';
      }
      this.emit('error', { message: userMessage });
      return false;
    }
  }

  async disconnect(): Promise<void> {
    try {
      if (this.rowingDataChar) {
        await this.rowingDataChar.stopNotifications();
      }
      if (this.device?.gatt?.connected) {
        this.device.gatt.disconnect();
      }
    } catch {
      // ignore disconnect errors
    }
    this.handleDisconnect();
  }

  private handleDisconnect(): void {
    if (!this.device && !this.server) return;
    this.device = null;
    this.server = null;
    this.rowingDataChar = null;
    this.emit('disconnected', {});
  }

  // Parse Rowing Machine Data characteristic per FTMS spec (Bluetooth SIG GATT spec 0x2AD1)
  parseRowingData(data: DataView): void {
    try {
      if (data.byteLength < 2) return;
      const flags = data.getUint16(0, true);
      let offset = 2;

      const parsed: Partial<PM5Data> = {};

      // Bit 0: More Data — when 0, Stroke Rate (uint8, res 0.5/min) and Stroke Count (uint16) present
      const moreData = (flags & 0x0001) !== 0;
      if (!moreData) {
        if (offset < data.byteLength) {
          parsed.cadence = Math.round(data.getUint8(offset) * 0.5);
          offset += 1;
        }
        if (offset + 1 < data.byteLength) {
          offset += 2; // Stroke Count — not mapped to PM5Data
        }
      }

      // Bit 1: Average Stroke Rate present (uint8, res 0.5/min)
      if ((flags & 0x0002) !== 0 && offset < data.byteLength) {
        offset += 1;
      }

      // Bit 2: Total Distance present (uint24, 1m resolution)
      if ((flags & 0x0004) !== 0 && offset + 2 < data.byteLength) {
        const lo = data.getUint16(offset, true);
        const hi = data.getUint8(offset + 2);
        parsed.distance = lo | (hi << 16);
        offset += 3;
      }

      // Bit 3: Instantaneous Pace present (uint16, 1/10 s per 500m)
      if ((flags & 0x0008) !== 0 && offset + 1 < data.byteLength) {
        parsed.pace = data.getUint16(offset, true) / 10;
        offset += 2;
      }

      // Bit 4: Average Pace present (uint16, 1/10 s per 500m)
      if ((flags & 0x0010) !== 0 && offset + 1 < data.byteLength) {
        if (parsed.pace === undefined) {
          parsed.pace = data.getUint16(offset, true) / 10;
        }
        offset += 2;
      }

      // Bit 5: Instantaneous Power present (sint16, 1W resolution)
      if ((flags & 0x0020) !== 0 && offset + 1 < data.byteLength) {
        parsed.power = data.getInt16(offset, true);
        offset += 2;
      }

      // Bit 6: Average Power present (sint16, 1W resolution)
      if ((flags & 0x0040) !== 0 && offset + 1 < data.byteLength) {
        if (parsed.power === undefined) {
          parsed.power = data.getInt16(offset, true);
        }
        offset += 2;
      }

      // Bit 7: Resistance Level present (sint16)
      if ((flags & 0x0080) !== 0 && offset + 1 < data.byteLength) {
        offset += 2;
      }

      // Bit 8: Expended Energy present (uint16 total kJ, uint16 per hour, uint8 per min)
      if ((flags & 0x0100) !== 0 && offset + 4 < data.byteLength) {
        parsed.calories = data.getUint16(offset, true);
        offset += 5;
      }

      // Bit 9: Heart Rate present (uint8, 1 bpm)
      if ((flags & 0x0200) !== 0 && offset < data.byteLength) {
        parsed.heartRate = data.getUint8(offset);
        offset += 1;
      }

      // Bit 10: Metabolic Equivalent present (uint8, res 0.1)
      if ((flags & 0x0400) !== 0 && offset < data.byteLength) {
        offset += 1;
      }

      // Bit 11: Elapsed Time present (uint16, 1s resolution → convert to ms)
      if ((flags & 0x0800) !== 0 && offset + 1 < data.byteLength) {
        parsed.elapsedTime = data.getUint16(offset, true) * 1000;
        offset += 2;
      }

      // Bit 12: Remaining Time present (uint16, 1s) — not mapped to PM5Data

      Object.assign(this.rowingData, parsed);
      this.emit('data', { ...this.rowingData });
    } catch (e) {
      console.warn('Error parsing FTMS Rowing Machine Data', e);
    }
  }

  getRowingData(): PM5Data {
    return { ...this.rowingData };
  }

  isConnected(): boolean {
    return this.device?.gatt?.connected ?? false;
  }

  on(event: string, listener: Function): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event)!.push(listener);
  }

  off(event: string, listener: Function): void {
    const callbacks = this.listeners.get(event);
    if (callbacks) {
      const index = callbacks.indexOf(listener);
      if (index > -1) callbacks.splice(index, 1);
    }
  }

  private emit(event: string, data: unknown): void {
    const callbacks = this.listeners.get(event);
    if (callbacks) {
      callbacks.forEach((cb) => cb(data));
    }
  }
}

export const ftmsService = new FTMSBluetoothService();
