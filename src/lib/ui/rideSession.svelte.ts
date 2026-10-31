/**
 * The ride-session store (#542 workout slice) — the live rower pipeline App.tsx
 * ran while a session was on, ported to a Svelte 5 runes store.
 *
 * It holds what the workout screen reads every frame: the latest rower packet,
 * the recording session, the heart-rate samples, the start sequence and the
 * finish. App subscribed the rower and heart-rate services for the lifetime of
 * the component — not from the device panels — so a session kept recording
 * after the view switched from Routes to the workout; the same reasoning keeps
 * those subscriptions here, on a store held in the shell that outlives every
 * navigation, alongside {@link SessionStore} (which owns device connection and
 * the start/demo actions).
 *
 * The 3D scene itself is the engine's (`src/lib/renderer/`), reached through the
 * `Canvas3DHost` seam; this store feeds it the per-frame row state via
 * {@link RideSessionStore.frame}. Services and the frame scheduler are injected
 * (defaulting to the production singletons) so a test drives the pipeline with
 * stubs and a synchronous scheduler, mirroring the other shell stores.
 */
import type { PM5Data, HeartRateSample, WaterRoute, WorkoutSession } from '../types/index';
import { bluetoothService } from '../services/bluetoothService';
import { ftmsBluetoothService } from '../services/ftmsBluetoothService';
import { heartRateBluetoothService } from '../services/heartRateBluetoothService';
import { workoutService } from '../services/workoutService';
import { pm5Simulator } from '../services/pm5SimulatorService';
import { heartRateSimulator } from '../services/heartRateSimulatorService';
import { formatSplit } from '../utils/formatters';
import {
  paceGhost,
  ghostDistanceAt,
  ghostFinishSeconds,
  gapMeters,
  type GhostSource,
} from '../../components/rower3d/ghost';
import { bestPaceOnRoute } from '../utils/sessionSummary';
import {
  saveCompletedSession,
  markSessionUploaded,
  loadSessions,
} from '../services/localStorageWorkoutStore';
import { StartSequenceStore, isStrokeReading } from './startSequence.svelte';
import type { SessionState, RowerType } from './sessionStore.svelte';
import type { GhostChoice } from './ghostChoice';
import type { RideFrame } from './rideCanvas';

export type { RideFrame };

/** The finish banner stays up this long, then the session ends (App FINISH_BANNER_MS). */
export const FINISH_BANNER_MS = 2000;

/** A rower BLE service, down to the slice the pipeline subscribes to. */
interface RowerEventSource {
  on(event: string, listener: (data: unknown) => void): void;
  off(event: string, listener: (data: unknown) => void): void;
}

/** The slice of {@link SessionStore} this store reads and drives. */
export interface RideSessionSession {
  activeRowerType: RowerType;
  isDemoMode: boolean;
  sessionActive: boolean;
  sessionState: SessionState;
  selectedRowerConnected: boolean;
  hrConnected: boolean;
  ghostChoice: GhostChoice;
  currentWorkout: {
    stop(): void;
    tick(data: PM5Data): void;
    /** The structured workout's speed factor, undefined for a free row. */
    readonly speedFactor?: number;
  };
}

/** The slice of {@link RoutesStore} this store reads. */
export interface RideSessionRoutes {
  selectedRoute: WaterRoute | null;
}

/**
 * The slice of {@link AuthStore} this store reads, to decide the guest vs
 * signed-in summary and to key the local save/history (App read `user`).
 * Defaults to signed-out so the store still constructs with two arguments.
 */
export interface RideSessionAuth {
  readonly user: { id: string } | null;
  readonly isAuthenticated: boolean;
}

export interface RideSessionDeps {
  workoutService: Pick<
    typeof workoutService,
    | 'updateSessionWithPM5Data'
    | 'updateSessionHeartRate'
    | 'getCurrentSession'
    | 'pauseSession'
    | 'resumeSession'
    | 'endSession'
  >;
  bluetoothService: RowerEventSource;
  ftmsBluetoothService: RowerEventSource;
  heartRateBluetoothService: RowerEventSource;
  pm5Simulator: Pick<typeof pm5Simulator, 'addListener' | 'removeListener' | 'stop'>;
  heartRateSimulator: Pick<typeof heartRateSimulator, 'stop'>;
  /** Frame scheduler, injected so a test runs the deferred updates synchronously. */
  raf: (cb: () => void) => void;
  now: () => number;
}

const defaultDeps = (): RideSessionDeps => ({
  workoutService,
  bluetoothService,
  ftmsBluetoothService,
  heartRateBluetoothService,
  pm5Simulator,
  heartRateSimulator,
  raf:
    typeof requestAnimationFrame !== 'undefined'
      ? (cb) => void requestAnimationFrame(() => cb())
      : (cb) => void setTimeout(cb, 0),
  now: () => (typeof performance !== 'undefined' ? performance.now() : Date.now()),
});

export class RideSessionStore {
  #deps: RideSessionDeps;
  #session: RideSessionSession;
  #routes: RideSessionRoutes;
  #auth: RideSessionAuth;

  // Live state read by the workout view each frame.
  pm5Data = $state<PM5Data | null>(null);
  currentSession = $state<WorkoutSession | null>(null);
  heartRateSamples = $state<HeartRateSample[]>([]);
  strokeAt = $state<number | null>(null);
  finish = $state<{ distanceMeters: number; elapsedMs: number } | null>(null);
  activityElapsedMs = $state(0);

  // The row just finished, held so the post-finish summary can show it over
  // the Routes screen (App's completedSession / guestCompletedSession). A
  // signed-in row goes in `completedSession`; a guest's in
  // `guestCompletedSession`; `completedSessionWasDemo` flags a simulated row,
  // which keeps the summary but never the upload (R5).
  completedSession = $state<WorkoutSession | null>(null);
  guestCompletedSession = $state<WorkoutSession | null>(null);
  completedSessionWasDemo = $state(false);

  readonly startSequence = new StartSequenceStore();

  // Plain (non-reactive) guards mirroring App's refs.
  #strokeSeen = false;
  #finishing = false;
  #pending: PM5Data | null = null;
  #rafScheduled = false;
  #hrProcessing = false;
  #activityTimer: ReturnType<typeof setInterval> | null = null;
  #finishTimer: ReturnType<typeof setTimeout> | null = null;

  readonly latestHeartRate = $derived(
    this.heartRateSamples.length > 0
      ? this.heartRateSamples[this.heartRateSamples.length - 1].bpm
      : (this.pm5Data?.heartRate ?? null),
  );
  readonly workoutElapsedTimeMs = $derived(
    this.pm5Data?.elapsedTime ? this.pm5Data.elapsedTime * 1000 : this.activityElapsedMs,
  );
  readonly elapsedSeconds = $derived(this.workoutElapsedTimeMs / 1000);
  readonly strokeIntensity = $derived(Math.min(1, Math.max(0.2, (this.pm5Data?.power ?? 0) / 300)));
  // These read the injected stores, so they defer through `$derived.by`: a
  // field initializer runs before the constructor assigns `#session`/`#routes`.
  readonly activityProgressPercent = $derived.by(() =>
    this.pm5Data && this.#routes.selectedRoute
      ? Math.min(100, (this.pm5Data.distance / 1000) / this.#routes.selectedRoute.distance * 100)
      : 0,
  );

  /** The ghost to race, resolved from the chosen option (App `ghostSource`). */
  readonly ghostSource = $derived.by<GhostSource | null>(() =>
    this.#session.ghostChoice.kind === 'pace'
      ? paceGhost(this.#session.ghostChoice.paceSPer500)
      : null,
  );
  readonly #ghostLabel = $derived.by(() =>
    this.#session.ghostChoice.kind === 'pace'
      ? `a ${formatSplit(this.#session.ghostChoice.paceSPer500)} pace`
      : 'your best',
  );

  /**
   * The gap to the ghost for the HUD (#338). Null until the row has actually
   * started — two boats on the line have no gap worth reading.
   */
  readonly ghostGap = $derived.by(() => {
    const ghost = this.ghostSource;
    if (!ghost) return null;
    const rowerMeters = this.pm5Data?.distance ?? 0;
    const started = this.workoutElapsedTimeMs > 0 && rowerMeters > 0;
    return {
      gapMeters: started
        ? gapMeters(rowerMeters, ghostDistanceAt(ghost, this.workoutElapsedTimeMs / 1000))
        : null,
      label: this.#ghostLabel,
    };
  });

  /**
   * How the race came out, for the summary (App `completedGhost`, #338). The
   * ghost's time to the distance the row actually covered, so a row cut short
   * is compared where it stopped rather than at a finish neither boat reached.
   */
  readonly completedGhost = $derived.by(() => {
    const completed = this.completedSession;
    const source = this.ghostSource;
    if (!completed || !source) return null;
    return { seconds: ghostFinishSeconds(source, completed.distance), label: this.#ghostLabel };
  });

  /**
   * This athlete's best on the route before this row (App `completedSessionBest`,
   * #337). None for a demo row, which is not theirs to compare, or without an
   * athlete to ask about.
   */
  readonly completedSessionBest = $derived.by(() => {
    const completed = this.completedSession;
    if (!completed || !this.#auth.user || this.completedSessionWasDemo) return undefined;
    return bestPaceOnRoute(loadSessions(this.#auth.user.id), completed);
  });

  constructor(
    session: RideSessionSession,
    routes: RideSessionRoutes,
    deps: Partial<RideSessionDeps> = {},
    auth: RideSessionAuth = { user: null, isAuthenticated: false },
  ) {
    this.#session = session;
    this.#routes = routes;
    this.#deps = { ...defaultDeps(), ...deps };
    this.#auth = auth;
  }

  /**
   * Subscribe to the rower and heart-rate services for the app's lifetime and
   * return a teardown. Only the selected rower drives the session; both stay
   * subscribed so a device left connected on the other tab does not interleave
   * its frames (App.tsx `activeRowerTypeRef`).
   */
  init(): () => void {
    const onPm5 = (data: unknown) => {
      if (this.#session.activeRowerType === 'pm5') this.#handleData(data as PM5Data);
    };
    const onFtms = (data: unknown) => {
      if (this.#session.activeRowerType === 'ftms') this.#handleData(data as PM5Data);
    };
    const onHr = (payload: unknown) => {
      const { bpm } = (payload ?? {}) as { bpm?: number };
      if (typeof bpm !== 'number') return;
      if (this.#hrProcessing) return;
      this.#hrProcessing = true;
      try {
        this.#deps.workoutService.updateSessionHeartRate(bpm);
      } finally {
        this.#hrProcessing = false;
      }
      this.#deps.raf(() => {
        const session = this.#deps.workoutService.getCurrentSession();
        this.heartRateSamples = session?.heartRateSamples ? [...session.heartRateSamples] : [];
      });
    };

    this.#deps.bluetoothService.on('data', onPm5);
    this.#deps.ftmsBluetoothService.on('data', onFtms);
    this.#deps.heartRateBluetoothService.on('heartRate', onHr);

    return () => {
      this.#deps.bluetoothService.off('data', onPm5);
      this.#deps.ftmsBluetoothService.off('data', onFtms);
      this.#deps.heartRateBluetoothService.off('heartRate', onHr);
      this.#stopActivityTimer();
      this.#clearFinishTimer();
    };
  }

  #demoListening = false;
  /** The demo feeds the same pipeline directly from the simulator (App gate). */
  setDemoListening(on: boolean): void {
    if (on === this.#demoListening) return;
    this.#demoListening = on;
    if (on) this.#deps.pm5Simulator.addListener(this.#demoListener);
    else this.#deps.pm5Simulator.removeListener(this.#demoListener);
  }
  #demoListener = (data: PM5Data): void => this.#handleData(data);

  /**
   * Start or stop the activity-elapsed timer with the session, and clear the
   * row's transient state when it ends (App's timer effect + the sessionEnded
   * listener). The owner drives this from an `$effect` on `session.sessionActive`.
   */
  setActive(active: boolean): void {
    if (active) {
      if (this.#activityTimer !== null) return;
      const startTime = Date.now();
      this.#activityTimer = setInterval(() => {
        this.activityElapsedMs = Date.now() - startTime;
      }, 250);
    } else {
      this.#stopActivityTimer();
      this.#clearFinishTimer();
      this.activityElapsedMs = 0;
      this.#strokeSeen = false;
      this.#finishing = false;
      this.strokeAt = null;
      this.finish = null;
      this.pm5Data = null;
      this.currentSession = null;
      this.heartRateSamples = [];
      this.startSequence.reset();
    }
  }

  /** Seed the recording session when it starts (App's sessionStarted listener). */
  onStarted(session: WorkoutSession | null): void {
    this.currentSession = session ?? null;
  }

  /**
   * Feed a simulated PM5 frame from the debug panel's PM5 simulator into the
   * same intake the demo uses (App wired the simulator through `handlePM5Data`).
   */
  onSimulatedData(data: PM5Data): void {
    this.#handleData(data);
  }

  pauseWorkout(): void {
    this.#session.sessionState = 'paused';
    this.#deps.workoutService.pauseSession();
  }

  resumeWorkout(): void {
    this.#session.sessionState = 'active';
    this.#deps.workoutService.resumeSession();
  }

  /** Reset the live metrics but keep the session (App `handleResetWorkout`). */
  resetWorkout(): void {
    this.activityElapsedMs = 0;
  }

  /**
   * End the row (App `handleEndWorkout`). `workoutService.endSession()`
   * dispatches `virtualrow:sessionEnded`, which the shell turns into navigation
   * back to Routes and `setActive(false)`; the completed row is then held so the
   * summary can show over the Routes screen.
   *
   * A guest's row goes to `guestCompletedSession`; a signed-in row is kept
   * locally before any upload (so a row the athlete declines to upload still
   * survives a reload, AC6.1) and goes to `completedSession`. The guest/
   * signed-in split follows the row's own `isGuest` flag, set from the guest
   * mode in force when it started.
   */
  endWorkout(): void {
    this.#clearFinishTimer();
    this.#finishing = false;
    this.finish = null;
    this.#strokeSeen = false;
    this.strokeAt = null;
    const completed = this.#deps.workoutService.endSession();
    this.#session.currentWorkout.stop();
    const wasDemo = this.#session.isDemoMode;
    this.completedSessionWasDemo = wasDemo;
    if (wasDemo) {
      this.#deps.pm5Simulator.stop();
      this.#deps.heartRateSimulator.stop();
    }

    if (!completed) return;

    if (completed.isGuest) {
      this.guestCompletedSession = completed;
      return;
    }

    if (this.#auth.user) saveCompletedSession(this.#auth.user.id, completed, { isDemo: wasDemo });
    this.completedSession = completed;
  }

  /** Record that the signed-in row reached intervals.icu (App `handleSessionSaved`, AC6.2). */
  sessionSaved(activityId: string): void {
    const completed = this.completedSession;
    if (this.#auth.user && completed) {
      markSessionUploaded(this.#auth.user.id, completed.id, activityId);
    }
  }

  /** Dismiss the signed-in summary (App `handleSessionDone`); the shell is already on Routes. */
  sessionDone(): void {
    this.completedSession = null;
  }

  /** Dismiss the guest summary (App `handleGuestRowAgain` / `handleGuestExit`). */
  guestDone(): void {
    this.guestCompletedSession = null;
  }

  /** The per-frame snapshot the engine pulls through the canvas seam. */
  frame(): RideFrame {
    return {
      paceSPer500: this.pm5Data?.pace ?? null,
      distanceMeters: this.pm5Data?.distance ?? null,
      cadence: this.pm5Data?.cadence ?? null,
      isPlaying: this.#session.sessionActive && this.#session.sessionState === 'active',
      holdBoat: this.startSequence.holdBoat,
      finished: this.finish !== null,
      // The structured workout's speed factor, 1 for a free row (App `intensityFactor`).
      intensityFactor: this.#session.currentWorkout.speedFactor ?? 1,
      elapsedSeconds: this.workoutElapsedTimeMs / 1000,
      ghost: this.ghostSource,
    };
  }

  /** App `handlePM5Data`: update the service now, defer the React-ish state to a frame. */
  #handleData(data: PM5Data): void {
    this.#deps.workoutService.updateSessionWithPM5Data(data);

    // The first stroke starts the countdown from a timer, not from the frame
    // below: a software renderer draws about a frame a second.
    if (this.#session.sessionActive && !this.#strokeSeen && isStrokeReading(data)) {
      this.#strokeSeen = true;
      const at = Date.now();
      setTimeout(() => {
        if (this.#strokeSeen) this.strokeAt = at;
      }, 0);
    }

    this.#pending = data;
    if (this.#rafScheduled) return;
    this.#rafScheduled = true;
    this.#deps.raf(() => {
      this.#rafScheduled = false;
      const latest = this.#pending;
      if (!latest) return;

      this.pm5Data = latest;
      // Advance the structured workout, if one is running; no-op for a free row.
      this.#session.currentWorkout.tick(latest);

      if (!this.#session.sessionActive) return;
      if (latest.heartRate) {
        const updated = this.#deps.workoutService.getCurrentSession();
        this.heartRateSamples = updated?.heartRateSamples ? [...updated.heartRateSamples] : [];
      }
      // Read straight from the service so mutated distance/duration are current.
      const latestSession = this.#deps.workoutService.getCurrentSession();
      this.currentSession = latestSession ? { ...latestSession } : null;

      this.#maybeFinish(latest, latestSession);
    });
  }

  /** Finish when distance reaches the route length (App finish detection). */
  #maybeFinish(latest: PM5Data, latestSession: WorkoutSession | null): void {
    const route = this.#routes.selectedRoute;
    if (!route || typeof window === 'undefined') return;
    if (window.__PLAYWRIGHT_TESTING && !window.__VIRTUALROW_AUTO_FINISH) return;
    const routeDistanceMeters = route.distance * 1000;
    const threshold = routeDistanceMeters * 0.995;
    if (latest.distance >= threshold && routeDistanceMeters > 0 && !this.#finishing) {
      this.#finishing = true;
      this.finish = {
        distanceMeters: routeDistanceMeters,
        elapsedMs: latest.elapsedTime
          ? latest.elapsedTime * 1000
          : (latestSession?.duration ?? 0) * 1000,
      };
      // The banner stays up, then the row ends and the summary opens.
      this.#finishTimer = setTimeout(() => this.endWorkout(), FINISH_BANNER_MS);
    }
  }

  #stopActivityTimer(): void {
    if (this.#activityTimer !== null) {
      clearInterval(this.#activityTimer);
      this.#activityTimer = null;
    }
  }

  #clearFinishTimer(): void {
    if (this.#finishTimer !== null) {
      clearTimeout(this.#finishTimer);
      this.#finishTimer = null;
    }
  }
}
