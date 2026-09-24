import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { isStrokeReading, useStartSequence, type StartSequenceInput } from '../hooks/useStartSequence';

/**
 * Issue #336 — a row starts on the first stroke, after a 3-2-1.
 *
 * `idle → armed → counting(3..1) → go → rowing`. The boat is held at the start
 * while armed and counting, and let go on "Row!".
 */

const input = (overrides: Partial<StartSequenceInput> = {}): StartSequenceInput => ({
  active: true,
  strokeAt: null,
  autoStart: false,
  ...overrides,
});

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

const advance = (ms: number) =>
  act(() => {
    vi.advanceTimersByTime(ms);
  });

describe('useStartSequence', () => {
  it('is idle, and holds nothing, without a session', () => {
    const { result } = renderHook(() => useStartSequence(input({ active: false })));
    expect(result.current).toEqual({ phase: 'idle', countdown: null, holdBoat: false });
  });

  it('arms on a new session and holds the boat until a stroke', () => {
    const { result } = renderHook(() => useStartSequence(input()));
    expect(result.current).toEqual({ phase: 'armed', countdown: null, holdBoat: true });

    advance(60_000);
    expect(result.current.phase).toBe('armed');
    expect(result.current.holdBoat).toBe(true);
  });

  it('counts 3, 2, 1 a second apart from the first stroke, then says row', () => {
    const { result, rerender } = renderHook((p: StartSequenceInput) => useStartSequence(p), {
      initialProps: input(),
    });

    rerender(input({ strokeAt: Date.now() }));
    expect(result.current).toEqual({ phase: 'counting', countdown: 3, holdBoat: true });

    advance(1000);
    expect(result.current.countdown).toBe(2);
    advance(1000);
    expect(result.current.countdown).toBe(1);
    expect(result.current.holdBoat).toBe(true);

    advance(1000);
    expect(result.current).toEqual({ phase: 'go', countdown: null, holdBoat: false });
  });

  it('clears "Row!" after a second and leaves the boat free', () => {
    const { result } = renderHook(() => useStartSequence(input({ strokeAt: Date.now() })));
    advance(3000);
    expect(result.current.phase).toBe('go');

    advance(1000);
    expect(result.current).toEqual({ phase: 'rowing', countdown: null, holdBoat: false });
  });

  it('does not restart the countdown on later strokes', () => {
    const { result, rerender } = renderHook((p: StartSequenceInput) => useStartSequence(p), {
      initialProps: input({ strokeAt: Date.now() }),
    });
    advance(1500);
    rerender(input({ strokeAt: null }));
    rerender(input({ strokeAt: Date.now() }));
    expect(result.current.countdown).toBe(2);
  });

  it('starts the countdown by itself in demo mode', () => {
    const { result } = renderHook(() => useStartSequence(input({ autoStart: true })));
    expect(result.current.phase).toBe('counting');
    expect(result.current.countdown).toBe(3);

    advance(4000);
    expect(result.current.phase).toBe('rowing');
  });

  it('goes back to idle when the session ends, and arms afresh for the next', () => {
    const { result, rerender } = renderHook((p: StartSequenceInput) => useStartSequence(p), {
      initialProps: input({ strokeAt: Date.now() }),
    });
    advance(5000);
    expect(result.current.phase).toBe('rowing');

    rerender(input({ active: false, strokeAt: Date.now() }));
    expect(result.current.phase).toBe('idle');

    // The erg still reports strokes from the last row; the next row waits for a
    // fresh one rather than counting down on a stale reading.
    rerender(input({ active: true, strokeAt: null }));
    expect(result.current.phase).toBe('armed');
  });

  it('stops counting when the session ends mid-countdown', () => {
    const { result, rerender } = renderHook((p: StartSequenceInput) => useStartSequence(p), {
      initialProps: input({ strokeAt: Date.now() }),
    });
    advance(1000);
    rerender(input({ active: false }));
    advance(10_000);
    expect(result.current).toEqual({ phase: 'idle', countdown: null, holdBoat: false });
  });

  it('does not replay an ended countdown into the next session', () => {
    const { result, rerender } = renderHook((p: StartSequenceInput) => useStartSequence(p), {
      initialProps: input({ strokeAt: Date.now() }),
    });
    advance(1000);
    rerender(input({ active: false }));
    rerender(input({ active: true }));
    advance(10_000);
    expect(result.current.phase).toBe('armed');
    expect(result.current.holdBoat).toBe(true);
  });
});

describe('useStartSequence timing', () => {
  it('counts from the stroke, not from when the page got round to it', () => {
    // The page was busy for 1.5 s after the drive: the count is already at 2,
    // and "Row!" is 1.5 s away rather than 3.
    const { result } = renderHook(() => useStartSequence(input({ strokeAt: Date.now() - 1500 })));
    expect(result.current.phase).toBe('counting');

    advance(0);
    expect(result.current.countdown).toBe(2);
    advance(500);
    expect(result.current.countdown).toBe(1);
    advance(1000);
    expect(result.current.phase).toBe('go');
  });
});

describe('isStrokeReading', () => {
  it('is a stroke when the erg reports a rate or power', () => {
    expect(isStrokeReading({ cadence: 22 })).toBe(true);
    expect(isStrokeReading({ power: 140 })).toBe(true);
  });

  it('is not a stroke at rest, or with nothing connected', () => {
    expect(isStrokeReading({ cadence: 0, power: 0 })).toBe(false);
    expect(isStrokeReading({})).toBe(false);
    expect(isStrokeReading(null)).toBe(false);
  });
});
