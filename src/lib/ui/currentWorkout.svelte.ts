/**
 * The rower's currently-loaded structured workout (#542 P1 — a Svelte-runes
 * port of `useCurrentWorkout`, issue #445).
 *
 * A workout is set imperatively from the outside — {@link LoadTodaysWorkoutButton}
 * fetches today's session from intervals.icu and hands it back through
 * {@link CurrentWorkoutStore.set}. There is no library and no picker (FR1).
 * Progress is tracked with the pure {@link WorkoutProgressController}, so the
 * store has no service dependency beyond the device-connected signal.
 *
 * It is cross-view state — the Row screen loads and starts a workout, the
 * workout screen ticks it — so it is held on the shared {@link SessionStore}.
 * See #445 FR1/FR7/AC12.
 */
import type {
  PM5Data,
  StructuredWorkout,
  WorkoutProgress,
  WorkoutSegment,
} from '../types/index';
import { validateWorkout, expandRepeats } from '../utils/workoutPlan';
import { WorkoutProgressController, segmentSpeedFactor } from '../utils/workoutProgress';

export class CurrentWorkoutStore {
  /** The workout that will run on the next session, if any. */
  current = $state<StructuredWorkout | null>(null);
  progress = $state<WorkoutProgress | null>(null);
  isRunning = $state(false);
  /** Why the current workout cannot be started; empty when it can. */
  validationErrors = $state<string[]>([]);

  #controller: WorkoutProgressController | null = null;
  // A reconnected ergometer brings a clock that kept running; the first reading
  // after a gap must not be counted as rowing (#67 §8).
  #wasConnected = true;

  /** The running workout's segments, repeats expanded, in rowing order. */
  readonly segments = $derived<WorkoutSegment[]>(
    this.current ? expandRepeats(this.current.segments) : [],
  );
  readonly isComplete = $derived(this.progress?.isComplete === true);
  /** Speed multiplier for the 3D scene, or undefined when nothing is running. */
  readonly speedFactor = $derived(
    this.isRunning && this.progress ? segmentSpeedFactor(this.progress.currentSegment) : undefined,
  );

  /** Load a workout as the current one; clears any progress. */
  set(workout: StructuredWorkout | null): void {
    this.current = workout;
    this.progress = null;
    this.isRunning = false;
    this.validationErrors = [];
    this.#controller = null;
  }

  /** Begin the current workout. Returns false if it did not start. */
  start(): boolean {
    if (!this.current) return false;
    const { valid, errors } = validateWorkout(this.current);
    if (!valid) {
      this.validationErrors = errors;
      return false;
    }
    this.#controller = new WorkoutProgressController(this.current);
    this.validationErrors = [];
    this.progress = this.#controller.getProgress();
    this.isRunning = true;
    return true;
  }

  /** End the workout and clear its progress. */
  stop(): void {
    this.#controller = null;
    this.isRunning = false;
    this.progress = null;
  }

  /** Feed a rower reading in; ignored unless a workout is running. */
  tick(pm5Data: PM5Data): void {
    if (!this.isRunning || !this.#controller) return;
    const next = this.#controller.update(pm5Data);
    this.progress = next;
    if (next.isComplete) {
      this.#controller = null;
      this.isRunning = false;
    }
  }

  /** Tell the controller the ergometer came back, so the gap is not rowed. */
  setDeviceConnected(connected: boolean): void {
    if (connected && !this.#wasConnected) this.#controller?.resumeAfterGap();
    this.#wasConnected = connected;
  }
}
