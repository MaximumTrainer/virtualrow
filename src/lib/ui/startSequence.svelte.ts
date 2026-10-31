/**
 * The start of a row (#336), ported from `src/hooks/useStartSequence.ts` to a
 * Svelte 5 runes store for the #542 workout slice.
 *
 * `idle → armed → counting(3..1) → go → rowing`. The boat waits at the start
 * until the first stroke (or, in the demo, straight away), a 3-2-1 plays a
 * second apart, and the boat is let go on "Row!". The whole count is scheduled
 * once, when it starts, and timed from the stroke rather than from the frame
 * that noticed it — a software renderer draws about a frame a second, and a
 * count that waits for a frame starts a second late.
 *
 * The React hook derived the phase during render and scheduled the steps in an
 * effect keyed on the count. Here the owner calls {@link setInputs} from an
 * `$effect` whenever its reactive inputs change; the transition runs
 * synchronously and the steps are scheduled with timers that a later input
 * change cancels. This keeps the store testable without a component (fake
 * timers + direct calls), mirroring the Row-screen stores.
 */

import type { StartPhase } from './startPhase';
export type { StartPhase };

/**
 * Whether a reading from the erg is of someone rowing. A PM5 at rest reports
 * no stroke rate and no power; the first stroke gives it both. (Ported from
 * useStartSequence so this store pulls in no React.)
 */
export const isStrokeReading = (
  data: { cadence?: number; power?: number } | null | undefined,
): boolean => (data?.cadence ?? 0) > 0 || (data?.power ?? 0) > 0;

export const COUNTDOWN_FROM = 3;
export const COUNTDOWN_STEP_MS = 1000;
/** How long "Row!" stays up once the boat is let go. */
export const GO_DISPLAY_MS = 1000;

export interface StartSequenceInput {
  /** A session is running. Ending it returns the sequence to idle. */
  active: boolean;
  /**
   * When the rower took their first stroke, as `Date.now()`, or null before
   * it. Read only while armed. A time rather than a flag, so the count runs
   * from the stroke and not from however late the page got round to it.
   */
  strokeAt: number | null;
  /** Count down without waiting for a stroke, as the demo does. */
  autoStart: boolean;
}

export class StartSequenceStore {
  #phase = $state<StartPhase>('idle');
  #countdown = $state<number | null>(null);
  /** Which countdown this is, so each one is scheduled once and cancelled cleanly. */
  #run = 0;
  #timers: ReturnType<typeof setTimeout>[] = [];

  readonly phase = $derived(this.#phase);
  readonly countdown = $derived(this.#countdown);
  /** The boat stays at progress 0 while this is true. */
  readonly holdBoat = $derived(this.#phase === 'armed' || this.#phase === 'counting');

  /**
   * Apply the latest inputs. Idempotent while nothing relevant changed, so the
   * owner can call it from an `$effect` on every input tick.
   */
  setInputs({ active, strokeAt, autoStart }: StartSequenceInput): void {
    if (!active) {
      if (this.#phase !== 'idle') {
        this.#cancel();
        this.#phase = 'idle';
        this.#countdown = null;
      }
      return;
    }
    if (this.#phase === 'idle') this.#phase = 'armed';
    if (this.#phase === 'armed' && (strokeAt !== null || autoStart)) {
      this.#phase = 'counting';
      this.#countdown = COUNTDOWN_FROM;
      // No stroke to time from in the demo: it counts from when it is scheduled.
      this.#schedule(strokeAt ?? 0);
    }
  }

  /** Stop and reset. The owner calls this when the session ends. */
  reset(): void {
    this.#cancel();
    this.#phase = 'idle';
    this.#countdown = null;
  }

  #schedule(from: number): void {
    this.#cancel();
    const run = ++this.#run;
    // Timed from the stroke, not from here, so a slow page cannot stretch it.
    const late = from ? Math.max(0, Date.now() - from) : 0;
    const steps: Array<[number, { phase: StartPhase; countdown: number | null }]> = [];
    for (let n = COUNTDOWN_FROM - 1; n >= 1; n--) {
      steps.push([(COUNTDOWN_FROM - n) * COUNTDOWN_STEP_MS, { phase: 'counting', countdown: n }]);
    }
    const goAt = COUNTDOWN_FROM * COUNTDOWN_STEP_MS;
    steps.push([goAt, { phase: 'go', countdown: null }]);
    steps.push([goAt + GO_DISPLAY_MS, { phase: 'rowing', countdown: null }]);
    this.#timers = steps.map(([at, step]) =>
      setTimeout(() => {
        if (this.#run !== run) return;
        this.#phase = step.phase;
        this.#countdown = step.countdown;
      }, Math.max(0, at - late)),
    );
  }

  #cancel(): void {
    this.#timers.forEach(clearTimeout);
    this.#timers = [];
  }
}
