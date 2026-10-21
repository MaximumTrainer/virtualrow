import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { flushSync } from 'svelte';

import {
  StartSequenceStore,
  isStrokeReading,
  COUNTDOWN_STEP_MS,
  GO_DISPLAY_MS,
} from '../lib/ui/startSequence.svelte';

// #542 workout slice: the start-of-row sequence, ported from useStartSequence.
describe('StartSequenceStore', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('holds at the start until the first stroke, then counts 3-2-1, go, rowing', () => {
    const s = new StartSequenceStore();
    const stop = $effect.root(() => {
      s.setInputs({ active: true, strokeAt: null, autoStart: false });
      flushSync();
      expect(s.phase).toBe('armed');
      expect(s.countdown).toBeNull();
      expect(s.holdBoat).toBe(true);

      // The stroke lands: the count starts from it.
      s.setInputs({ active: true, strokeAt: Date.now(), autoStart: false });
      flushSync();
      expect(s.phase).toBe('counting');
      expect(s.countdown).toBe(3);
      expect(s.holdBoat).toBe(true);

      vi.advanceTimersByTime(COUNTDOWN_STEP_MS);
      flushSync();
      expect(s.countdown).toBe(2);
      vi.advanceTimersByTime(COUNTDOWN_STEP_MS);
      flushSync();
      expect(s.countdown).toBe(1);

      vi.advanceTimersByTime(COUNTDOWN_STEP_MS);
      flushSync();
      expect(s.phase).toBe('go');
      expect(s.countdown).toBeNull();
      expect(s.holdBoat).toBe(false);

      vi.advanceTimersByTime(GO_DISPLAY_MS);
      flushSync();
      expect(s.phase).toBe('rowing');
    });
    stop();
  });

  it('auto-starts the count without a stroke in the demo', () => {
    const s = new StartSequenceStore();
    const stop = $effect.root(() => {
      s.setInputs({ active: true, strokeAt: null, autoStart: true });
      flushSync();
      expect(s.phase).toBe('counting');
      expect(s.countdown).toBe(3);
    });
    stop();
  });

  it('returns to idle and cancels the count when the session ends', () => {
    const s = new StartSequenceStore();
    const stop = $effect.root(() => {
      s.setInputs({ active: true, strokeAt: Date.now(), autoStart: false });
      flushSync();
      expect(s.phase).toBe('counting');

      s.setInputs({ active: false, strokeAt: null, autoStart: false });
      flushSync();
      expect(s.phase).toBe('idle');
      expect(s.countdown).toBeNull();
      expect(s.holdBoat).toBe(false);

      // The cancelled timers never fire the stale steps.
      vi.advanceTimersByTime(10_000);
      flushSync();
      expect(s.phase).toBe('idle');
    });
    stop();
  });

  it('reset() stops and clears a running count', () => {
    const s = new StartSequenceStore();
    const stop = $effect.root(() => {
      s.setInputs({ active: true, strokeAt: null, autoStart: true });
      flushSync();
      expect(s.phase).toBe('counting');
      s.reset();
      flushSync();
      expect(s.phase).toBe('idle');
      vi.advanceTimersByTime(10_000);
      flushSync();
      expect(s.phase).toBe('idle');
    });
    stop();
  });

  it('runs the count from the stroke, not from when it was noticed', () => {
    const s = new StartSequenceStore();
    const stop = $effect.root(() => {
      // The stroke was 900 ms ago (a slow page). The first tick is then 100 ms off.
      const strokeAt = Date.now();
      vi.advanceTimersByTime(900);
      s.setInputs({ active: true, strokeAt, autoStart: false });
      flushSync();
      expect(s.countdown).toBe(3);
      vi.advanceTimersByTime(100);
      flushSync();
      expect(s.countdown).toBe(2);
    });
    stop();
  });
});

describe('isStrokeReading', () => {
  it('is false at rest and true once there is cadence or power', () => {
    expect(isStrokeReading(null)).toBe(false);
    expect(isStrokeReading({ cadence: 0, power: 0 })).toBe(false);
    expect(isStrokeReading({ cadence: 20 })).toBe(true);
    expect(isStrokeReading({ power: 120 })).toBe(true);
  });
});
