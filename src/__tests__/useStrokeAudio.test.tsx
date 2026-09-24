import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useStrokeAudio } from '../hooks/useStrokeAudio';
import type { AudioPort } from '../ports';

/**
 * Issue #339 — the stroke you hear.
 *
 * The catch is what makes a stroke feel connected to the screen, so it is
 * played on the transition into it rather than on every render that happens to
 * find the phase there: at 60 fps a drive lasts some forty renders, and forty
 * splashes is white noise.
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

const strokes = (phases: string[], options: { intensity?: number; reduced?: boolean } = {}) => {
  const { rerender } = renderHook(
    ({ phase }: { phase: string }) =>
      useStrokeAudio(audio, phase, options.intensity ?? 1, options.reduced ?? false),
    { initialProps: { phase: phases[0] } },
  );
  for (const phase of phases.slice(1)) rerender({ phase });
};

describe('the stroke’s sound', () => {
  it('plays once as the blade goes in, not once a frame', () => {
    strokes(['recovery', 'catch', 'catch', 'catch', 'drive']);

    expect(audio.splash).toHaveBeenCalledTimes(1);
  });

  it('plays again on the next stroke', () => {
    strokes(['recovery', 'catch', 'drive', 'finish', 'recovery', 'catch']);

    // One per catch; the finish is quieter but it is still a sound.
    const catches = audio.splash.mock.calls.filter((call) => (call[0] as number) > 0.5);
    expect(catches).toHaveLength(2);
  });

  // The finish is the blade coming out, which is a smaller sound than the
  // blade going in. Same splash, less of it.
  it('plays the finish more quietly than the catch', () => {
    strokes(['recovery', 'catch', 'drive', 'finish']);

    const [atCatch, atFinish] = audio.splash.mock.calls.map((call) => call[0] as number);
    expect(atFinish).toBeLessThan(atCatch);
  });

  /**
   * The stroke's own loudness.
   *
   * A light paddle and a racing catch are the same sound at different volumes,
   * so the intensity the physics reports is passed through rather than a
   * constant that makes every stroke sound like the same stroke.
   */
  it('is as loud as the stroke that made it', () => {
    strokes(['recovery', 'catch'], { intensity: 0.3 });
    const gentle = audio.splash.mock.calls[0][0] as number;

    audio = port();
    strokes(['recovery', 'catch'], { intensity: 1 });
    const hard = audio.splash.mock.calls[0][0] as number;

    expect(hard).toBeGreaterThan(gentle);
  });

  /**
   * `prefers-reduced-motion` is a request not to be startled (#344).
   *
   * A rower who has asked for less movement has not asked for a noise on every
   * stroke either, so the stroke sounds are not added automatically — the water
   * bed and the cues the rower asked for still play.
   */
  it('adds nothing on a stroke for a rower who asked for less', () => {
    strokes(['recovery', 'catch', 'drive', 'finish'], { reduced: true });

    expect(audio.splash).not.toHaveBeenCalled();
  });

  it('says nothing while the sound is switched off', () => {
    audio.isEnabled = vi.fn(() => false);

    strokes(['recovery', 'catch']);

    expect(audio.splash).not.toHaveBeenCalled();
  });

  // The first phase the hook sees is where the stroke already was, not a
  // transition into it: a page that loads mid-drive should not splash.
  it('does not play for the phase it started on', () => {
    strokes(['catch']);

    expect(audio.splash).not.toHaveBeenCalled();
  });
});

// A scene mounted with no sound wired to it at all — the default everywhere
// the audio port has not been passed down.
describe('a scene with no sound at all', () => {
  it('plays nothing, and does not fall over trying', () => {
    const { rerender } = renderHook(
      ({ phase }: { phase: string }) => useStrokeAudio(null, phase, 1, false),
      { initialProps: { phase: 'recovery' } },
    );

    expect(() => rerender({ phase: 'catch' })).not.toThrow();
  });
});
