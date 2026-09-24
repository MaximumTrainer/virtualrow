import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useRaceCues } from '../hooks/useRaceCues';
import type { AudioPort } from '../ports';
import type { StartPhase } from '../hooks/useStartSequence';

/**
 * Issue #339 — the cues a rower listens for rather than looks for.
 *
 * The countdown and the finish are the two moments the screen asks a rower to
 * notice while they are looking at the handle. A sine chirp is the whole point
 * of having sound at all: it reaches them without their having to read.
 *
 * Unlike the stroke sounds, these are *not* suppressed under reduced motion.
 * A rower who asked for less movement asked for less movement, and a countdown
 * they cannot hear is a countdown they have to watch for.
 */

const port = () => {
  const audio = {
    enable: vi.fn(async () => {}),
    disable: vi.fn(async () => {}),
    isEnabled: vi.fn(() => true),
    setVolume: vi.fn(),
    getVolume: vi.fn(() => 0.5),
    splash: vi.fn(),
    cue: vi.fn(),
    startWater: vi.fn(),
    stopWater: vi.fn(),
  };
  return audio as unknown as AudioPort & typeof audio;
};

let audio: ReturnType<typeof port>;

beforeEach(() => {
  audio = port();
});

interface Step {
  phase: StartPhase;
  countdown: number | null;
  finished?: boolean;
}

const run = (steps: Step[]) => {
  const { rerender } = renderHook(
    (step: Step) => useRaceCues(audio, step.phase, step.countdown, step.finished ?? false),
    { initialProps: steps[0] },
  );
  for (const step of steps.slice(1)) rerender(step);
};

describe('the countdown', () => {
  it('chirps once for each number', () => {
    run([
      { phase: 'armed', countdown: null },
      { phase: 'counting', countdown: 3 },
      { phase: 'counting', countdown: 2 },
      { phase: 'counting', countdown: 1 },
    ]);

    expect(audio.cue).toHaveBeenCalledTimes(3);
  });

  // A re-render is not a second three.
  it('does not chirp again for a number it is still on', () => {
    run([
      { phase: 'counting', countdown: 3 },
      { phase: 'counting', countdown: 3 },
      { phase: 'counting', countdown: 3 },
    ]);

    expect(audio.cue).toHaveBeenCalledTimes(1);
  });

  // "Row!" is the one that matters, so it is not the same note as the count.
  it('marks the start with a different note from the count', () => {
    run([
      { phase: 'counting', countdown: 1 },
      { phase: 'go', countdown: null },
    ]);

    const [counted, go] = audio.cue.mock.calls.map((call) => call[0] as number);
    expect(go).toBeGreaterThan(counted);
  });

  it('marks the start once, not on every render of it', () => {
    run([
      { phase: 'counting', countdown: 1 },
      { phase: 'go', countdown: null },
      { phase: 'go', countdown: null },
      { phase: 'rowing', countdown: null },
    ]);

    expect(audio.cue).toHaveBeenCalledTimes(2);
  });
});

describe('the finish', () => {
  it('sounds when the line is crossed', () => {
    run([
      { phase: 'rowing', countdown: null },
      { phase: 'rowing', countdown: null, finished: true },
    ]);

    expect(audio.cue).toHaveBeenCalledTimes(1);
  });

  it('sounds once, however long the banner stays up', () => {
    run([
      { phase: 'rowing', countdown: null },
      { phase: 'rowing', countdown: null, finished: true },
      { phase: 'rowing', countdown: null, finished: true },
    ]);

    expect(audio.cue).toHaveBeenCalledTimes(1);
  });
});

describe('with the sound off', () => {
  it('says nothing', () => {
    audio.isEnabled = vi.fn(() => false);

    run([
      { phase: 'counting', countdown: 3 },
      { phase: 'go', countdown: null, finished: true },
    ]);

    expect(audio.cue).not.toHaveBeenCalled();
  });

  it('does not fall over with no sound wired at all', () => {
    const { rerender } = renderHook(
      (step: Step) => useRaceCues(null, step.phase, step.countdown, step.finished ?? false),
      { initialProps: { phase: 'counting', countdown: 3 } as Step },
    );

    expect(() => rerender({ phase: 'go', countdown: null, finished: true })).not.toThrow();
  });
});
