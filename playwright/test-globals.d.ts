/**
 * Globals that only exist while Playwright is driving the app.
 *
 * The app's own debug hooks (`__workoutService`, the `__ROWER3D_*` telemetry,
 * `__SELECTED_ROUTE`) are declared beside the code that sets them, in
 * `src/types/index.ts`. The hooks below are installed by the test harness
 * itself — `playwright/mock-bluetooth.js` and the simulator server — so they
 * have no home in `src/`.
 *
 * Without these, every call-site went through `(window as any)`, which is why
 * `virtualrow.spec.ts` alone carried 51 `no-explicit-any` errors and 19
 * `@ts-ignore` comments. A cast also silences a renamed hook until the suite
 * fails at runtime; a declaration fails in the editor instead.
 */

/**
 * One notified GATT characteristic, faked by mock-bluetooth.js. `_dispatch`
 * pushes a frame to every `characteristicvaluechanged` listener, which is how
 * a test feeds the app device data without real hardware.
 */
interface MockBluetoothCharacteristic {
  _dispatch: (value: DataView) => void;
  addEventListener: (event: string, handler: (event: { target: { value: DataView } }) => void) => void;
  removeEventListener: (event: string, handler: (event: { target: { value: DataView } }) => void) => void;
}

declare global {
  interface Window {
    /**
     * Sends frames to the simulator server over its WebSocket. Only does
     * anything while `npm run start:sim` is up — the emitters are no-ops when
     * the socket is not open, so a spec that needs data without the server
     * should dispatch through the characteristics below instead.
     */
    __simulator?: {
      emitPM5: (payload: Record<string, number>) => void;
      emitFTMS: (payload: { flags: number; bytes: number[] }) => void;
      emitHR: (payload: { bpm: number }) => void;
      startSequence: (id: string, sequence: unknown) => Promise<boolean>;
      startRoute: (id: string, options: Record<string, number>) => Promise<boolean>;
      startFtmsRoute: (id: string, options: Record<string, number>) => Promise<boolean>;
    };

    /** PM5 multiplexed characteristic, exposed so a test can push frames. */
    __pm5CharMux?: MockBluetoothCharacteristic;
    /** PM5 general-status characteristic. */
    __pm5CharGeneral?: MockBluetoothCharacteristic;
    /** Heart-rate measurement characteristic. */
    __hrChar?: MockBluetoothCharacteristic;
    /** Additional PM5 status characteristic. */
    __pm5CharAdditional?: MockBluetoothCharacteristic;
    /** Generic FTMS rower characteristic. */
    __ftmsChar?: MockBluetoothCharacteristic;
  }
}

export {};
