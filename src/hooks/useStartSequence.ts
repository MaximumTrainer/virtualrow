import { useEffect, useState } from 'react';

/**
 * The start of a row (#336): the boat waits at the start until the first
 * stroke, a 3-2-1 plays a second apart, and it is let go on "Row!".
 *
 * `idle → armed → counting(3..1) → go → rowing`. `go` is the second "Row!" is
 * on screen; the boat is already free by then.
 */

/**
 * Whether a reading from the erg is of someone rowing. A PM5 at rest reports
 * no stroke rate and no power; the first stroke gives it both.
 */
export const isStrokeReading = (data: { cadence?: number; power?: number } | null | undefined): boolean =>
  (data?.cadence ?? 0) > 0 || (data?.power ?? 0) > 0;

export type StartPhase = 'idle' | 'armed' | 'counting' | 'go' | 'rowing';

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

export interface StartSequence {
  phase: StartPhase;
  /** 3, 2 or 1 while counting; null otherwise. */
  countdown: number | null;
  /** The boat stays at progress 0 while this is true. */
  holdBoat: boolean;
}

export const COUNTDOWN_FROM = 3;
export const COUNTDOWN_STEP_MS = 1000;
/** How long "Row!" stays up once the boat is let go. */
export const GO_DISPLAY_MS = 1000;

type State = {
  phase: StartPhase;
  countdown: number | null;
  /** Which countdown this is, so each one is scheduled once. */
  run: number;
  /** When this countdown started, as `Date.now()`, or 0 for "when scheduled". */
  from: number;
};

export function useStartSequence({ active, strokeAt, autoStart }: StartSequenceInput): StartSequence {
  const [state, setState] = useState<State>({ phase: 'idle', countdown: null, run: 0, from: 0 });

  // Derived during render rather than in an effect, so the first frame of a
  // session is already held and a stroke starts the count on the frame it
  // arrives.
  let next = state;
  if (!active) {
    if (state.phase !== 'idle') next = { ...state, phase: 'idle', countdown: null };
  } else {
    if (next.phase === 'idle') next = { ...next, phase: 'armed' };
    if (next.phase === 'armed' && (strokeAt !== null || autoStart)) {
      next = {
        phase: 'counting',
        countdown: COUNTDOWN_FROM,
        run: state.run + 1,
        // No stroke to time from in the demo: it counts from when it is scheduled.
        from: strokeAt ?? 0,
      };
    }
  }
  if (next !== state) setState(next);

  // The whole sequence is scheduled when the count starts, rather than each
  // step from the render the last one caused, and timed from the stroke rather
  // than from this effect, so a slow page cannot stretch it. On a software
  // renderer the effect ran over a second after the drive, and "Row!" came
  // 4.3-4.7 s after it where the count is three.
  // Ending the session cancels it, and a session that has not started counting
  // has nothing scheduled.
  const run = next.phase === 'idle' || next.phase === 'armed' ? 0 : next.run;
  const { from } = next;
  useEffect(() => {
    if (run === 0) return undefined;
    const late = from ? Math.max(0, Date.now() - from) : 0;
    const steps: Array<[number, Pick<State, 'phase' | 'countdown'>]> = [];
    for (let n = COUNTDOWN_FROM - 1; n >= 1; n--) {
      steps.push([(COUNTDOWN_FROM - n) * COUNTDOWN_STEP_MS, { phase: 'counting', countdown: n }]);
    }
    const goAt = COUNTDOWN_FROM * COUNTDOWN_STEP_MS;
    steps.push([goAt, { phase: 'go', countdown: null }]);
    steps.push([goAt + GO_DISPLAY_MS, { phase: 'rowing', countdown: null }]);
    const ids = steps.map(([at, step]) =>
      setTimeout(
        () => setState((s) => (s.run === run ? { ...s, ...step } : s)),
        Math.max(0, at - late),
      ),
    );
    return () => ids.forEach(clearTimeout);
  }, [run, from]);

  return {
    phase: next.phase,
    countdown: next.countdown,
    holdBoat: next.phase === 'armed' || next.phase === 'counting',
  };
}
