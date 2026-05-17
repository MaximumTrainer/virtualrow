// Heart Rate BLE integration leveraging standard Heart Rate Service (0x180D)
// Characteristic: Heart Rate Measurement (0x2A37)
import type { HeartRateSample } from '../types/index';

export class HeartRateBluetoothService {
  private device: BluetoothDevice | null = null;
  private server: BluetoothRemoteGATTServer | null = null;
  private hrService: BluetoothRemoteGATTService | null = null;
  private hrChar: BluetoothRemoteGATTCharacteristic | null = null;
  private listeners: Map<string, Function[]> = new Map();
  private samples: HeartRateSample[] = [];
  // Suppress spurious disconnect calls (e.g. React event replay) for a short window after connect
  private suppressDisconnectUntil = 0;
  private readonly DISCONNECT_SUPPRESSION_MS = 2000;

  // Standard UUIDs
  private readonly HR_SERVICE_UUID = '0000180d-0000-1000-8000-00805f9b34fb'; // Heart Rate Service
  private readonly HR_MEASUREMENT_CHAR_UUID = '00002a37-0000-1000-8000-00805f9b34fb'; // Heart Rate Measurement characteristic

  async connect(): Promise<boolean> {
    try {
      if (!navigator.bluetooth) throw new Error('Web Bluetooth API not supported');
      // Guard against duplicate registration if already connected
      if (this.hrChar && this.device?.gatt?.connected) {
        this.suppressDisconnectUntil = performance.now() + this.DISCONNECT_SUPPRESSION_MS;
        this.emit('connected', { name: this.device.name });
        return true;
      }
      this.device = await navigator.bluetooth.requestDevice({
        filters: [{ services: [this.HR_SERVICE_UUID] }],
        optionalServices: ['device_information'],
      });

      this.emit('connecting', { name: this.device.name });
      this.device.addEventListener('gattserverdisconnected', () => this.handleDisconnect());
      this.server = await this.device.gatt?.connect() || null;
      if (!this.server) throw new Error('Failed to connect GATT server');

      this.hrService = await this.server.getPrimaryService(this.HR_SERVICE_UUID);
      this.hrChar = await this.hrService.getCharacteristic(this.HR_MEASUREMENT_CHAR_UUID);
      await this.hrChar.startNotifications();
      this.hrChar.addEventListener('characteristicvaluechanged', (e) => this.handleHRNotification(e));

      this.suppressDisconnectUntil = performance.now() + this.DISCONNECT_SUPPRESSION_MS;
      this.emit('connected', { name: this.device.name });
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.emit('error', { message: msg });
      return false;
    }
  }

  async disconnect() {
    // Suppress spurious disconnects fired shortly after connecting (e.g. React event replay)
    if (performance.now() < this.suppressDisconnectUntil) return;
    try {
      if (this.hrChar) await this.hrChar.stopNotifications();
      if (this.device?.gatt?.connected) this.device.gatt.disconnect();
    } catch (e) {
      // ignore
    } finally {
      this.handleDisconnect();
    }
  }

  private handleDisconnect() {
    this.device = null;
    this.server = null;
    this.hrService = null;
    this.hrChar = null;
    this.emit('disconnected', {});
  }

  private handleHRNotification(event: Event) {
    const char = event.target as unknown as BluetoothRemoteGATTCharacteristic;
    if (!char.value) return;
    const bpm = this.parseHeartRate(char.value);
    if (bpm !== undefined) {
      const sample: HeartRateSample = { bpm, timestamp: new Date() };
      this.samples.push(sample);
      if (this.samples.length > 1200) this.samples.shift(); // limit ~20min if 1s updates
      this.emit('heartRate', sample);
    }
  }

  // Parse Heart Rate Measurement characteristic per Bluetooth spec
  private parseHeartRate(data: DataView): number | undefined {
    if (data.byteLength < 2) return undefined;
    const flags = data.getUint8(0);
    const hrValueFormatUINT16 = (flags & 0x01) === 0x01;
    let offset = 1;
    let hr: number;
    if (hrValueFormatUINT16) {
      if (data.byteLength < 3) return undefined;
      hr = data.getUint16(offset, true);
      offset += 2;
    } else {
      hr = data.getUint8(offset);
      offset += 1;
    }
    return hr;
  }

  getSamples(): HeartRateSample[] {
    return [...this.samples];
  }

  isConnected(): boolean {
    return !!this.device?.gatt?.connected;
  }

  on(event: string, listener: Function) {
    if (!this.listeners.has(event)) this.listeners.set(event, []);
    this.listeners.get(event)!.push(listener);
  }

  off(event: string, listener: Function) {
    const list = this.listeners.get(event);
    if (!list) return;
    const idx = list.indexOf(listener);
    if (idx > -1) list.splice(idx, 1);
  }

  private emit(event: string, payload: unknown) {
    const list = this.listeners.get(event) || [];
    list.forEach((l) => {
      try { l(payload); } catch (_) {/* ignore listener errors */}
    });
  }
}

export const heartRateBluetoothService = new HeartRateBluetoothService();
