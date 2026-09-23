import { describe, it, expect, afterEach, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useReducedMotion, useReducedMotionRef } from '../hooks/useReducedMotion';

/**
 * Issue #344 — the scene answers to the system's motion setting.
 *
 * jsdom has no `matchMedia` at all, which is the case that matters most here:
 * an absent API is not a preference either way, and a hook that read it as
 * "reduce" would hold the whole scene still for every rower in a webview.
 */

/** A `matchMedia` whose answer the test controls, and can change. */
const installMatchMedia = (initial: boolean) => {
  let matches = initial;
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  const query = vi.fn((queryString: string) => ({
    matches,
    media: queryString,
    addEventListener: (_: string, handler: (event: MediaQueryListEvent) => void) =>
      listeners.add(handler),
    removeEventListener: (_: string, handler: (event: MediaQueryListEvent) => void) =>
      listeners.delete(handler),
  }));
  Object.defineProperty(window, 'matchMedia', { configurable: true, writable: true, value: query });

  return {
    query,
    change(next: boolean) {
      matches = next;
      for (const handler of listeners) handler({ matches: next } as MediaQueryListEvent);
    },
    get listenerCount() {
      return listeners.size;
    },
  };
};

afterEach(() => {
  Reflect.deleteProperty(window, 'matchMedia');
  vi.restoreAllMocks();
});

describe('the reduced-motion preference', () => {
  it('asks for the preference by name', () => {
    const media = installMatchMedia(false);
    renderHook(() => useReducedMotion());

    expect(media.query).toHaveBeenCalledWith('(prefers-reduced-motion: reduce)');
  });

  it('reports what the system says', () => {
    installMatchMedia(true);
    const { result } = renderHook(() => useReducedMotion());

    expect(result.current).toBe(true);
  });

  // The setting can be turned on part-way through a row, and the motion it is
  // meant to stop is happening at that moment.
  it('notices it being turned on mid-row', () => {
    const media = installMatchMedia(false);
    const { result } = renderHook(() => useReducedMotion());
    expect(result.current).toBe(false);

    act(() => media.change(true));

    expect(result.current).toBe(true);
  });

  it('stops listening when the scene goes away', () => {
    const media = installMatchMedia(false);
    const { unmount } = renderHook(() => useReducedMotion());
    expect(media.listenerCount).toBe(1);

    unmount();

    expect(media.listenerCount).toBe(0);
  });

  // No `matchMedia` is no answer, not an answer of "reduce". A webview without
  // it would otherwise get a scene with the motion taken out of it.
  it('leaves the scene as authored where there is nothing to ask', () => {
    const { result } = renderHook(() => useReducedMotion());

    expect(result.current).toBe(false);
  });

  describe('as a ref, for the frame loop', () => {
    it('carries the preference without a re-render', () => {
      const media = installMatchMedia(true);
      let renders = 0;
      const { result } = renderHook(() => {
        renders += 1;
        return useReducedMotionRef();
      });

      expect(result.current.current).toBe(true);
      const rendersAfterMount = renders;

      act(() => media.change(false));

      expect(result.current.current).toBe(false);
      expect(renders, 'the scene re-rendered to learn a frame-loop value').toBe(rendersAfterMount);
    });

    it('defaults to the authored motion where there is nothing to ask', () => {
      const { result } = renderHook(() => useReducedMotionRef());

      expect(result.current.current).toBe(false);
    });
  });
});
