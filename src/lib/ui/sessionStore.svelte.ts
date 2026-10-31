/**
 * The session store (#542 P1 — a Svelte-runes port of the device, demo and
 * session-lifecycle state App.tsx held at the top of the component).
 *
 * This is cross-view state, held once in the app shell (`+layout.svelte`) and
 * read from both the Row screen (which connects a device and starts a session)
 * and the workout screen (which rows it). App subscribed the rower and
 * heart-rate BLE services for the lifetime of the component precisely so a
 * session kept recording after the view switched to the workout; the same
 * reasoning puts those subscriptions here, on a store that outlives every
 * navigation, rather than on the per-screen device panels.
 *
 * P1 scope: connection tracking (so the Start button enables), the sound
 * switch, the loaded structured workout, and the start/demo actions that open
 * a session. Starting a session fires `virtualrow:sessionStarted` on `window`,
 * which the shell's bridge turns into navigation to the workout route; the live
 * rower-data pipeline (physics, recording, the HUD) lands with the workout
 * slice. Services are injected (defaulting to the production singletons) so a
 * test can supply stubs, mirroring {@link RoutesStore} / {@link AuthStore}.
 */
import type { WaterRoute } from '../types/index';
import { bluetoothService } from '../services/bluetoothService';
import { ftmsBluetoothService } from '../services/ftmsBluetoothService';
import { heartRateBluetoothService } from '../services/heartRateBluetoothService';
import { workoutService } from '../services/workoutService';
import { audioService } from '../services/audioService';
import { pm5Simulator } from '../services/pm5SimulatorService';
import { heartRateSimulator } from '../services/heartRateSimulatorService';
import { CurrentWorkoutStore } from './currentWorkout.svelte';
import type { GhostChoice } from './ghostChoice';

export type SessionState = 'idle' | 'active' | 'paused';
export type RowerType = 'pm5' | 'ftms';

/** The slice of a BLE service the store subscribes to for connection state. */
interface EventService {
  on(event: string, listener: (data: unknown) => void): void;
  off(event: string, listener: (data: unknown) => void): void;
}

/** The plain singletons the store drives (not part of the DI `Services` bundle). */
export interface SessionStoreDeps {
  bluetoothService: EventService;
  ftmsBluetoothService: EventService;
  heartRateBluetoothService: EventService;
  workoutService: Pick<typeof workoutService, 'startSession' | 'getCurrentSession'>;
  audioService: Pick<typeof audioService, 'getVolume' | 'setVolume' | 'enable' | 'disable'>;
  pm5Simulator: Pick<typeof pm5Simulator, 'updateSettings' | 'start' | 'isRunning'>;
  heartRateSimulator: Pick<typeof heartRateSimulator, 'start' | 'isRunning'>;
}

const defaultDeps = (): SessionStoreDeps => ({
  bluetoothService,
  ftmsBluetoothService,
  heartRateBluetoothService,
  workoutService,
  audioService,
  pm5Simulator,
  heartRateSimulator,
});

export class SessionStore {
  #deps: SessionStoreDeps;

  // Device selection and connection. The selected rower drives the session;
  // both services stay subscribed so a device left connected on the other tab
  // does not interleave its frames (App.tsx `activeRowerTypeRef`).
  activeRowerType = $state<RowerType>('pm5');
  pm5Connected = $state(false);
  ftmsConnected = $state(false);
  hrConnected = $state(false);

  // Session lifecycle. `sessionActive` and `sessionState` are driven by the
  // shell's `window` session bridge; `isDemoMode` flags a simulated row.
  sessionActive = $state(false);
  sessionState = $state<SessionState>('idle');
  isDemoMode = $state(false);

  // The ghost to race (App.tsx `ghostChoice`). Kept here because the scene
  // reads it during the workout; the Row screen only sets it.
  ghostChoice = $state<GhostChoice>({ kind: 'none' });

  // The loaded structured workout (#445).
  readonly currentWorkout = new CurrentWorkoutStore();

  // Sound switch (App.tsx `soundEnabled` / `soundVolume`). The water-loop that
  // plays under a running row lands with the workout slice.
  soundEnabled = $state(false);
  soundVolume = $state(0.5);

  // Guards a double-start from rapid clicks or a re-entrant call.
  #starting = false;

  readonly activeRowerLabel = $derived(this.activeRowerType === 'pm5' ? 'PM5' : 'FTMS');
  readonly selectedRowerConnected = $derived(
    this.activeRowerType === 'pm5' ? this.pm5Connected : this.ftmsConnected,
  );

  constructor(deps: Partial<SessionStoreDeps> = {}) {
    this.#deps = { ...defaultDeps(), ...deps };
    this.soundVolume = this.#deps.audioService.getVolume();
  }

  /**
   * Subscribe to the BLE services' connect/disconnect for the lifetime of the
   * app and return a teardown. App kept these listeners alive outside the view
   * so a workout still saw the device after the Row screen unmounted.
   */
  init(): () => void {
    const onPm5Connected = () => (this.pm5Connected = true);
    const onPm5Disconnected = () => (this.pm5Connected = false);
    const onFtmsConnected = () => (this.ftmsConnected = true);
    const onFtmsDisconnected = () => (this.ftmsConnected = false);
    const onHrConnected = () => (this.hrConnected = true);
    const onHrDisconnected = () => (this.hrConnected = false);

    this.#deps.bluetoothService.on('connected', onPm5Connected);
    this.#deps.bluetoothService.on('disconnected', onPm5Disconnected);
    this.#deps.ftmsBluetoothService.on('connected', onFtmsConnected);
    this.#deps.ftmsBluetoothService.on('disconnected', onFtmsDisconnected);
    this.#deps.heartRateBluetoothService.on('connected', onHrConnected);
    this.#deps.heartRateBluetoothService.on('disconnected', onHrDisconnected);

    return () => {
      this.#deps.bluetoothService.off('connected', onPm5Connected);
      this.#deps.bluetoothService.off('disconnected', onPm5Disconnected);
      this.#deps.ftmsBluetoothService.off('connected', onFtmsConnected);
      this.#deps.ftmsBluetoothService.off('disconnected', onFtmsDisconnected);
      this.#deps.heartRateBluetoothService.off('connected', onHrConnected);
      this.#deps.heartRateBluetoothService.off('disconnected', onHrDisconnected);
    };
  }

  setActiveRowerType(type: RowerType): void {
    this.activeRowerType = type;
  }

  /** HeartRateMonitor's own callbacks also report connectivity (App.tsx). */
  setHrConnected(connected: boolean): void {
    this.hrConnected = connected;
  }

  setSoundEnabled(enabled: boolean): void {
    this.soundEnabled = enabled;
    void (enabled ? this.#deps.audioService.enable() : this.#deps.audioService.disable());
  }

  setSoundVolume(volume: number): void {
    this.soundVolume = volume;
    this.#deps.audioService.setVolume(volume);
  }

  /**
   * Start a real workout on the selected route (App.tsx `handleStartWorkout`).
   * A loaded structured workout runs over the top; if it cannot start, the row
   * still goes ahead as a free row (#67 §2, F.3). Navigation is the shell's job,
   * driven by the `virtualrow:sessionStarted` event this fires.
   */
  startWorkout(route: WaterRoute | null, isGuestSession: boolean): void {
    if (this.#starting || this.sessionActive || this.#deps.workoutService.getCurrentSession()) return;
    this.#starting = true;
    try {
      if (!route || !this.selectedRowerConnected || !this.hrConnected) return;
      this.#deps.workoutService.startSession(
        route.id,
        route.name,
        undefined,
        this.activeRowerType,
        this.hrConnected,
        isGuestSession,
        route.coordinates,
      );
      this.currentWorkout.start();
      this.sessionState = 'active';
    } finally {
      this.#starting = false;
    }
  }

  /**
   * Start a demo row on simulated devices (App.tsx `handleStartDemo`). The
   * caller gates visibility; this re-checks `demoAllowed` so a future shortcut
   * cannot bypass the gate (#219 FR5). Still flagged as a demo and not recorded
   * as a real workout.
   */
  startDemo(route: WaterRoute | null, isGuestSession: boolean, demoAllowed: boolean): void {
    if (this.#starting || this.sessionActive || this.#deps.workoutService.getCurrentSession()) return;
    if (!route || !demoAllowed) return;
    this.#starting = true;
    try {
      this.isDemoMode = true;
      this.#deps.pm5Simulator.updateSettings({
        pace: 120,
        cadence: 24,
        heartRate: 130,
        power: 150,
        isRowing: true,
      });
      this.#deps.pm5Simulator.start();
      if (!this.#deps.heartRateSimulator.isRunning()) this.#deps.heartRateSimulator.start(130);
      this.pm5Connected = true;
      this.activeRowerType = 'pm5';
      this.#deps.workoutService.startSession(
        route.id,
        route.name,
        undefined,
        'pm5',
        true,
        isGuestSession,
        route.coordinates,
      );
      // #472 FR4 — a signed-out guest's auto-seeded placeholder (and a
      // signed-in rower's manually-loaded one) run during the demo too, so
      // `WorkoutBlockPanel` paints its block image over the demo row. No-op
      // when no workout is loaded (`start()` returns false).
      this.currentWorkout.start();
      this.sessionState = 'active';
    } finally {
      this.#starting = false;
    }
  }

  /** The shell's session bridge calls these on the window session events. */
  onSessionStarted(): void {
    this.sessionActive = true;
    this.sessionState = 'active';
  }

  onSessionEnded(): void {
    this.sessionActive = false;
    this.sessionState = 'idle';
  }
}
