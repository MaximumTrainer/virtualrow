import { useEffect, useRef } from 'react';
import type { AudioPort } from '../ports';

/**
 * The stroke you hear (issue #339).
 *
 * The catch is what makes a stroke feel connected to the screen. It is played
 * on the transition *into* the phase rather than on every render that finds the
 * phase there: at 60 fps a drive lasts some forty renders, and forty splashes
 * is white noise.
 */

/** The blade going in — the sound the stroke is built around. */
const CATCH_LOUDNESS = 0.9;

/** The blade coming out, which is a smaller event than the blade going in. */
const FINISH_LOUDNESS = 0.35;

export const useStrokeAudio = (
  /** Null while the scene has no sound wired to it at all. */
  audio: AudioPort | null,
  strokePhase: string,
  /** How hard the stroke was, 0..1, from the physics. */
  intensity = 1,
  /**
   * True when the rower has asked for reduced motion. They have not asked for
   * a noise on every stroke either (#344), so the stroke sounds are not added
   * automatically — the water bed and the cues they did ask for still play.
   */
  reducedMotion = false,
): void => {
  // Where the stroke already was when this mounted. Null so the first phase
  // seen is not treated as a transition into it: a page that loads mid-drive
  // should not splash.
  const previous = useRef<string | null>(null);

  useEffect(() => {
    const was = previous.current;
    previous.current = strokePhase;

    if (was === null || was === strokePhase) return;
    if (!audio || reducedMotion || !audio.isEnabled()) return;

    if (strokePhase === 'catch') audio.splash(CATCH_LOUDNESS * intensity);
    else if (strokePhase === 'finish') audio.splash(FINISH_LOUDNESS * intensity);
  }, [audio, strokePhase, intensity, reducedMotion]);
};
