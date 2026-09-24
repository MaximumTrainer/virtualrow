import { useEffect, useRef } from 'react';
import type { AudioPort } from '../ports';
import type { StartPhase } from './useStartSequence';

/**
 * The cues a rower listens for rather than looks for (issue #339).
 *
 * The countdown and the finish are the two moments the screen asks a rower to
 * notice while they are looking at the handle. A chirp reaches them without
 * their having to read, which is most of the reason to have sound at all.
 *
 * Unlike the stroke sounds, these are not suppressed under reduced motion: a
 * rower who asked for less movement asked for less movement, and a countdown
 * they cannot hear is a countdown they have to watch for.
 */

/** The count. Low enough to sit under the note that means go. */
const COUNT_HZ = 660;

/** "Row!" — a higher note, so it is not mistaken for another number. */
const GO_HZ = 990;

/** The line. Longer than the others, because nothing follows it. */
const FINISH_HZ = 880;

export const useRaceCues = (
  audio: AudioPort | null,
  phase: StartPhase,
  countdown: number | null,
  finished: boolean,
): void => {
  const lastCount = useRef<number | null>(null);
  // The phase this hook first saw, which is where the row already was rather
  // than a transition into it: a component remounting mid-row must not chirp
  // "Row!" at a rower who is a kilometre down the course.
  const lastPhase = useRef<StartPhase | null>(null);
  const announcedGo = useRef(false);
  const announcedFinish = useRef(false);

  useEffect(() => {
    const playable = audio !== null && audio.isEnabled();

    // Each number once: a re-render is not a second three.
    if (countdown !== null && countdown !== lastCount.current) {
      if (playable) audio.cue(COUNT_HZ, 110);
    }
    lastCount.current = countdown;

    const startedRowing = phase === 'go' || phase === 'rowing';
    const wasFirstSighting = lastPhase.current === null;
    lastPhase.current = phase;

    if (startedRowing) {
      if (!announcedGo.current) {
        // Marked as announced either way: a row that was already under way
        // when this first saw it has had its start, whether or not anyone
        // heard it here.
        announcedGo.current = true;
        if (playable && !wasFirstSighting) audio.cue(GO_HZ, 220);
      }
    } else if (phase === 'idle' || phase === 'armed') {
      // A new row gets its own start.
      announcedGo.current = false;
    }

    if (finished) {
      if (!announcedFinish.current) {
        announcedFinish.current = true;
        if (playable) audio.cue(FINISH_HZ, 320);
      }
    } else {
      announcedFinish.current = false;
    }
  }, [audio, phase, countdown, finished]);
};
