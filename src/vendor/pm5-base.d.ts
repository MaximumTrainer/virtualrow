/**
 * Hand-written type declarations for the vendored PM5 BLE wrapper.
 *
 * The source is `pm5-base.js` (a CommonJS-flavoured JS file). These declarations
 * describe the *public surface used by the app*, not every internal method. The
 * goal is to remove `any` from consumers (currently `Concept2BluetoothService`).
 */

/**
 * Decoded fields emitted by PM5 status callbacks. Field availability depends
 * on the message type (general-status, additional-status, multiplexed, etc.),
 * so every field is optional.
 */
export interface PM5MessageData {
  currentPace?: number;
  averagePace?: number;
  elapsedTime?: number;
  distance?: number;
  strokeRate?: number;
  heartRate?: number;
  averagePower?: number;
  /** Any other PM5 field passed through verbatim by the wrapper. */
  [key: string]: unknown;
}

/** Envelope passed to the multiplexed `cb_message` callback. */
export interface PM5Message {
  type?: string;
  data?: PM5MessageData;
}

/** Event payload delivered to characteristic-specific listeners. */
export interface PM5Event {
  type: string;
  data: PM5MessageData;
}

/** Identifier shape for a PM5 BLE characteristic. */
export interface CharacteristicId {
  id: string;
  service: { id: string };
}

/**
 * Minimal subset of the upstream `PM5` class used by `bluetoothService.ts`.
 * Additional methods exist on the wrapper but are intentionally omitted to
 * keep this surface honest and easy to maintain.
 */
export default class PM5 {
  constructor(
    cb_connecting: () => void,
    cb_connected: () => void,
    cb_disconnected: () => void,
    cb_message: (msg: PM5Message) => void,
  );

  /** The underlying Web Bluetooth device once connected. */
  device: BluetoothDevice | null;

  /** Initiate the BLE pairing + GATT connection sequence. */
  doConnect(): Promise<void>;

  /** Tear down the GATT connection (idempotent). */
  doDisconnect(): void;

  /** Whether the GATT server is currently connected. */
  connected(): boolean;

  /** Subscribe to a named PM5 characteristic-derived event. */
  addEventListener(
    type:
      | 'multiplexed-information'
      | 'general-status'
      | 'additional-status'
      | 'additional-status2'
      | 'stroke-data'
      | 'disconnect'
      | string,
    callback: (event: PM5Event) => void,
  ): Promise<void>;

  /** Send a raw buffer to the PM5 control-service transmit characteristic. */
  writeTransmit(value: ArrayBuffer | ArrayBufferView): Promise<void>;

  /**
   * Internal helper to fetch a GATT characteristic. Marked optional here
   * because the wrapper does not formally export it as part of its public
   * API — callers must guard with a runtime check.
   */
  _getCharacteristic?(
    characteristic: CharacteristicId,
  ): Promise<BluetoothRemoteGATTCharacteristic>;
}
