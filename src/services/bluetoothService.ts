import type { PM5Data } from '../types/index';
import type PM5Type from '../vendor/pm5-base.js';
import type { PM5Message } from '../vendor/pm5-base.js';

export class Concept2BluetoothService {
  private device: BluetoothDevice | null = null;
  private txChar: BluetoothRemoteGATTCharacteristic | null = null;
  private pm5Wrapper: PM5Type | null = null;
  private listeners: Map<string, Array<(data: unknown) => void>> = new Map();
  // Suppress spurious disconnect calls (e.g. React event replay) for a short window after connect
  private suppressDisconnectUntil = 0;
  private readonly DISCONNECT_SUPPRESSION_MS = 2000;
  private pm5Data: PM5Data = {
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
      
      // Dynamically import PM5 wrapper to avoid ES module issues in tests
      const pm5Module = await import('../vendor/pm5-base.js');
      const PM5 = (pm5Module.default ?? pm5Module) as typeof PM5Type;

      // Pass a no-op as cb_connected so the event doesn't fire mid-connect before all
      // characteristic listeners are registered. We emit 'connected' ourselves below
      // once the service is fully ready.
      this.pm5Wrapper = new PM5(
        () => this.emit('connecting', {}),
        () => { /* deferred — see emit below */ },
        () => this.handleDisconnect(),
        // Multiplexed/misc messages
        (msg: PM5Message) => this.handlePM5Message(msg)
      );

      await this.pm5Wrapper.doConnect();

      // After connection, keep a reference to the underlying device
      try {
        this.device = this.pm5Wrapper.device || null;
      } catch {
        // Ignored; wrapper may not expose them on older versions
      }

      // Try to obtain the control transmit characteristic for sending commands
      if (this.pm5Wrapper && this.pm5Wrapper._getCharacteristic) {
        try {
          this.txChar = await this.pm5Wrapper._getCharacteristic({ id: 'ce060021-43e5-11e4-916c-0800200c9a66', service: { id: 'ce060020-43e5-11e4-916c-0800200c9a66' } });
        } catch {
          // fallback if unavailable
          this.txChar = null;
        }
      }

      // Register for parsed events we care about
      // Note: multiplexed-information is already registered by doConnect() via the cb_message constructor arg
      await this.pm5Wrapper.addEventListener('additional-status', (e) => this.handlePM5Message({ type: 'additional-status', data: e.data }));
      await this.pm5Wrapper.addEventListener('general-status', (e) => this.handlePM5Message({ type: 'general-status', data: e.data }));

      // Listen for disconnect events from the device
      await this.pm5Wrapper.addEventListener('disconnect', () => {
        console.log('PM5 device disconnected');
        this.handleDisconnect();
      });

      // Emit 'connected' only after ALL characteristic listeners are registered so that
      // handlers receiving the first data frames immediately after connection are in place.
      this.suppressDisconnectUntil = performance.now() + this.DISCONNECT_SUPPRESSION_MS;
      this.emit('connected', { deviceName: this.pm5Wrapper?.device?.name || 'PM5' });
      
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('Bluetooth connection error:', message);
      
      // Provide more actionable error messages
      let userMessage = message;
      if (message.includes('No Services matching UUID')) {
        userMessage = 'PM5 service not found. Please:\n1. Ensure PM5 is powered ON\n2. Unpair and re-pair the PM5 via Bluetooth settings\n3. Move closer to the PM5 device\n4. Try again in 10-15 seconds';
      } else if (message.includes('User cancelled')) {
        userMessage = 'Device selection cancelled. Please try again.';
      } else if (message.includes('GATT server')) {
        userMessage = 'Failed to connect to PM5 GATT server. Try re-pairing the device.';
      }
      
      this.emit('error', { message: userMessage });
      return false;
    }
  }

  async disconnect(): Promise<void> {
    // Suppress spurious disconnects fired shortly after connecting (e.g. React event replay)
    if (performance.now() < this.suppressDisconnectUntil) return;
    try {
      if (this.pm5Wrapper) {
        await this.pm5Wrapper.doDisconnect();
      }
      // Note: handleDisconnect will be called by the cb_disconnected callback
    } catch (error) {
      console.error('Disconnect error:', error);
    }
  }

  private handleDisconnect(): void {
    // Prevent duplicate disconnect handling
    if (!this.device && !this.pm5Wrapper) {
      return;
    }
    
    console.log('Handling PM5 disconnect');
    this.device = null;
    this.txChar = null;
    this.pm5Wrapper = null;
    this.emit('disconnected', {});
  }


  private handlePM5Message(msg: PM5Message): void {
    try {
      const data = msg && msg.data ? msg.data : {};
      const parsed: Partial<PM5Data> = {};
      // Map pm5-base fields to pm5Data
      if (data.currentPace != null) parsed.pace = Number(data.currentPace); // seconds per 500m
      else if (data.averagePace != null) parsed.pace = Number(data.averagePace);
      if (data.elapsedTime != null) parsed.elapsedTime = Number(data.elapsedTime);
      if (data.distance != null) parsed.distance = Number(data.distance);
      if (data.strokeRate != null) parsed.cadence = Number(data.strokeRate);
      if (data.heartRate != null) parsed.heartRate = Number(data.heartRate);
      if (data.averagePower != null) parsed.power = Number(data.averagePower);
      Object.assign(this.pm5Data, parsed);
      this.emit('data', this.pm5Data);
    } catch (e) {
      console.warn('Error handling PM5 message', e);
    }
  }

  // Note: Raw DataView parsing is left in for legacy fallback but pm5-base provides parsed events

  async sendCommand(command: string, params?: unknown[]): Promise<void> {
    // Use transmitter if available
    try {
      const toSend = this.buildMessage(command, params);
      const buffer = new Uint8Array(toSend.buffer, toSend.byteOffset, toSend.byteLength);
      if (this.pm5Wrapper && typeof this.pm5Wrapper.writeTransmit === 'function') {
        await this.pm5Wrapper.writeTransmit(buffer);
        return;
      }

      // Fallback: write to characteristic directly if available on the wrapper
      if (this.txChar) {
        await this.txChar.writeValue(buffer as BufferSource);
        return;
      }

      throw new Error('No transmit channel available');
    } catch (error) {
      console.error('Error sending command:', error);
      this.emit('error', { message: `Failed to send command: ${command}` });
    }
  }

  private buildMessage(command: string, params?: unknown[]): DataView {
    // Build Concept2 PM5 command message
    // This is a simplified version - actual format depends on protocol
    const buffer = new ArrayBuffer(20);
    const view = new DataView(buffer);

    // Message format: [command_type, ...params]
    let offset = 0;

    // Write command
    view.setUint8(offset++, this.commandToCode(command));

    // Write parameters if provided
    if (params) {
      for (const param of params) {
        if (typeof param === 'number') {
          view.setUint32(offset, param, true);
          offset += 4;
        }
      }
    }

    return new DataView(buffer, 0, offset);
  }

  private commandToCode(command: string): number {
    // Map command names to PM5 protocol codes
    const commands: { [key: string]: number } = {
      reset: 0x01,
      start: 0x02,
      stop: 0x03,
      pause: 0x04,
    };
    return commands[command] || 0x00;
  }

  getPM5Data(): PM5Data {
    return { ...this.pm5Data };
  }

  isConnected(): boolean {
    if (this.pm5Wrapper && typeof this.pm5Wrapper.connected === 'function') {
      return this.pm5Wrapper.connected();
    }
    return this.device?.gatt?.connected ?? false;
  }

  on(event: string, listener: (data: unknown) => void): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event)!.push(listener);
  }

  off(event: string, listener: (data: unknown) => void): void {
    const callbacks = this.listeners.get(event);
    if (callbacks) {
      const index = callbacks.indexOf(listener);
      if (index > -1) {
        callbacks.splice(index, 1);
      }
    }
  }

  private emit(event: string, data: unknown): void {
    const callbacks = this.listeners.get(event);
    if (callbacks) {
      callbacks.slice().forEach((cb) => {
        try { cb(data); } catch { /* prevent cascade from listener errors */ }
      });
    }
  }
}

export const bluetoothService = new Concept2BluetoothService();
