/**
 * FTMS (Fitness Machine Service) Bluetooth Low Energy service.
 *
 * Connects to any BLE rowing machine advertising the FTMS Fitness Machine Service
 * (UUID 0x1826) and subscribes to the Rower Data Characteristic (UUID 0x2AD1).
 *
 * The emitted PM5Data events use the same schema as the Concept2 PM5 service so that
 * the rest of the app (workout tracking, overlays, export) is device-agnostic.
 *
 * FTMS Rower Data bitfield layout (FTMS 1.0 spec, Section 4.9.1):
 *   Bit 0  – More Data (0 = stroke rate + count present, 1 = absent)
 *   Bit 1  – Average Stroke Rate present
 *   Bit 2  – Total Distance present
 *   Bit 3  – Instantaneous Pace present
 *   Bit 4  – Average Pace present
 *   Bit 5  – Instantaneous Power present
 *   Bit 6  – Average Power present
 *   Bit 7  – Resistance Level present
 *   Bit 8  – Expended Energy present  (3 bytes: kcal uint16, kcal/hr uint16, kcal/min uint8)
 *   Bit 9  – Heart Rate present        (1 byte uint8)
 *   Bit 10 – Metabolic Equivalent present (1 byte uint8)
 *   Bit 11 – Elapsed Time present      (2 bytes uint16, seconds)
 *   Bit 12 – Remaining Time present    (2 bytes uint16, seconds)
 */

import type { PM5Data } from '../types/index';

const FTMS_SERVICE_UUID = '00001826-0000-1000-8000-00805f9b34fb';
const ROWER_DATA_CHAR_UUID = '00002ad1-0000-1000-8000-00805f9b34fb';

export class FTMSBluetoothService {
  private device: BluetoothDevice | null = null;
  private listeners: Map<string, Array<(...args: any[]) => void>> = new Map();
  private latestData: PM5Data = {
    pace: 0,
    distance: 0,
    elapsedTime: 0,
    power: 0,
    cadence: 0,
    heartRate: 0,
    calories: 0,
  };

  on(event: string, handler: (...args: any[]) => void): void {
    const handlers = this.listeners.get(event) ?? [];
    handlers.push(handler);
    this.listeners.set(event, handlers);
  }

  off(event: string, handler: (...args: any[]) => void): void {
    const handlers = this.listeners.get(event) ?? [];
    this.listeners.set(event, handlers.filter((h) => h !== handler));
  }

  private emit(event: string, ...args: any[]): void {
    const handlers = this.listeners.get(event) ?? [];
    for (const h of handlers) h(...args);
  }

  async connect(): Promise<boolean> {
    try {
      if (!navigator.bluetooth) {
        throw new Error('Web Bluetooth API not supported in this browser');
      }

      this.device = await navigator.bluetooth.requestDevice({
        filters: [{ services: [FTMS_SERVICE_UUID] }],
        optionalServices: [FTMS_SERVICE_UUID],
      });

      this.device.addEventListener('gattserverdisconnected', () => {
        this.handleDisconnect();
      });

      const server = await this.device.gatt!.connect();
      const service = await server.getPrimaryService(FTMS_SERVICE_UUID);
      const rowerChar = await service.getCharacteristic(ROWER_DATA_CHAR_UUID);

      rowerChar.addEventListener('characteristicvaluechanged', (event: any) => {
        const value: DataView = event.target.value;
        this.parseRowerData(value);
      });

      await rowerChar.startNotifications();

      this.emit('connected', { deviceName: this.device.name ?? 'FTMS Rower' });
      return true;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      let userMessage = msg;
      if (msg.includes('User cancelled')) {
        userMessage = 'Device selection cancelled.';
      } else if (msg.includes('No Services matching UUID')) {
        userMessage = 'FTMS Rowing Service not found. Ensure the machine is powered on and advertising.';
      }
      this.emit('error', { message: userMessage });
      return false;
    }
  }

  async disconnect(): Promise<void> {
    try {
      if (this.device?.gatt?.connected) {
        this.device.gatt.disconnect();
      }
    } catch {
      // ignore
    }
  }

  private handleDisconnect(): void {
    this.device = null;
    this.emit('disconnected');
  }

  /**
   * Parse a Rower Data Characteristic notification value into PM5Data.
   *
   * All multi-byte fields are little-endian. Byte offsets advance according
   * to which optional fields are present (indicated by flag bits).
   */
  parseRowerData(view: DataView): PM5Data {
    const flags = view.getUint16(0, true);
    let offset = 2;

    const hasMoreData     = (flags & 0x0001) !== 0; // bit 0 inverted: 1 = NO basic data
    const hasAvgStroke    = (flags & 0x0002) !== 0;
    const hasTotalDist    = (flags & 0x0004) !== 0;
    const hasInstPace     = (flags & 0x0008) !== 0;
    const hasAvgPace      = (flags & 0x0010) !== 0;
    const hasInstPower    = (flags & 0x0020) !== 0;
    const hasAvgPower     = (flags & 0x0040) !== 0;
    const hasResistance   = (flags & 0x0080) !== 0;
    const hasEnergy       = (flags & 0x0100) !== 0;
    const hasHeartRate    = (flags & 0x0200) !== 0;
    const hasMetabolic    = (flags & 0x0400) !== 0;
    const hasElapsedTime  = (flags & 0x0800) !== 0;
    const hasRemainingTime = (flags & 0x1000) !== 0;

    let strokeRate = 0;
    let strokeCount = 0;
    let avgStrokeRate = 0;
    let totalDistance = 0;
    let instantPace = 0;
    let avgPace = 0;
    let instantPower = 0;
    let calories = 0;
    let heartRate = 0;
    let elapsedTime = 0;

    // Basic data (Stroke Rate + Stroke Count) — present when bit 0 is 0
    if (!hasMoreData) {
      if (offset + 1 > view.byteLength) return this.latestData;
      // Stroke Rate: uint8, resolution 0.5 spm → actual = raw / 2
      strokeRate = view.getUint8(offset) / 2;
      offset += 1;
      if (offset + 2 > view.byteLength) return this.latestData;
      strokeCount = view.getUint16(offset, true);
      offset += 2;
    }

    if (hasAvgStroke) {
      if (offset + 1 > view.byteLength) return this.latestData;
      avgStrokeRate = view.getUint8(offset) / 2;
      offset += 1;
      void avgStrokeRate;
    }

    if (hasTotalDist) {
      if (offset + 3 > view.byteLength) return this.latestData;
      // uint24, little-endian
      totalDistance =
        view.getUint8(offset) |
        (view.getUint8(offset + 1) << 8) |
        (view.getUint8(offset + 2) << 16);
      offset += 3;
    }

    if (hasInstPace) {
      if (offset + 2 > view.byteLength) return this.latestData;
      // FTMS pace: uint16, unit = 1/100 second per 500 m (centiseconds) — same as PM5Data.pace
      instantPace = view.getUint16(offset, true);
      offset += 2;
    }

    if (hasAvgPace) {
      if (offset + 2 > view.byteLength) return this.latestData;
      avgPace = view.getUint16(offset, true);
      offset += 2;
      void avgPace;
    }

    if (hasInstPower) {
      if (offset + 2 > view.byteLength) return this.latestData;
      // sint16
      instantPower = view.getInt16(offset, true);
      offset += 2;
    }

    if (hasAvgPower) {
      if (offset + 2 > view.byteLength) return this.latestData;
      offset += 2; // sint16, not used in PM5Data
    }

    if (hasResistance) {
      if (offset + 2 > view.byteLength) return this.latestData;
      offset += 2; // sint16
    }

    if (hasEnergy) {
      // Total Energy (uint16) + Energy Per Hour (uint16) + Energy Per Minute (uint8)
      if (offset + 5 > view.byteLength) return this.latestData;
      calories = view.getUint16(offset, true);
      offset += 5;
    }

    if (hasHeartRate) {
      if (offset + 1 > view.byteLength) return this.latestData;
      heartRate = view.getUint8(offset);
      offset += 1;
    }

    if (hasMetabolic) {
      if (offset + 1 > view.byteLength) return this.latestData;
      offset += 1; // uint8
    }

    if (hasElapsedTime) {
      if (offset + 2 > view.byteLength) return this.latestData;
      // uint16, seconds
      elapsedTime = view.getUint16(offset, true);
      offset += 2;
    }

    if (hasRemainingTime) {
      if (offset + 2 > view.byteLength) return this.latestData;
      offset += 2; // uint16, seconds — not used
    }

    void strokeCount;

    // Update accumulated state based on field-presence flags; explicit zeroes are preserved when a field is present
    this.latestData = {
      pace: hasInstPace ? instantPace : this.latestData.pace,
      distance: hasTotalDist ? totalDistance : this.latestData.distance,
      elapsedTime: hasElapsedTime ? elapsedTime : this.latestData.elapsedTime,
      power: hasInstPower ? instantPower : this.latestData.power,
      cadence: !hasMoreData ? Math.round(strokeRate) : this.latestData.cadence,
      heartRate: hasHeartRate ? heartRate : this.latestData.heartRate,
      calories: hasEnergy ? calories : this.latestData.calories,
    };

    this.emit('data', this.latestData);
    return this.latestData;
  }

  getLatestData(): PM5Data {
    return { ...this.latestData };
  }

  isConnected(): boolean {
    return this.device?.gatt?.connected ?? false;
  }
}

export const ftmsBluetoothService = new FTMSBluetoothService();
