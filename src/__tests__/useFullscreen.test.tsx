import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useFullscreen } from '../hooks/useFullscreen';

/**
 * Issue #335 — the stage can fill the screen, and the page knows when it does.
 *
 * jsdom implements neither `requestFullscreen` nor `fullscreenElement`, which
 * is convenient: it is exactly the shape iOS Safari presents, so the fallback
 * path is the default here and the supported path is the one that has to be
 * built up.
 */

/** A ref to a real element, because the hook refuses to act without one. */
const stageRef = () => {
  const element = document.createElement('div');
  document.body.appendChild(element);
  return { current: element } as React.RefObject<HTMLElement | null>;
};

/**
 * Give the document the Fullscreen API it does not have, backed by a variable
 * the test can read — so "did it ask?" and "what did it ask for?" are both
 * answerable without stubbing the hook's own state.
 */
const installFullscreenApi = () => {
  let current: Element | null = null;
  // `mock.instances` is what records which element asked, so the body only has
  // to note that something did.
  const request = vi.fn(function (this: Element) {
    current = request.mock.instances[request.mock.instances.length - 1] as unknown as Element;
    document.dispatchEvent(new Event('fullscreenchange'));
    return Promise.resolve();
  });
  const exit = vi.fn(() => {
    current = null;
    document.dispatchEvent(new Event('fullscreenchange'));
    return Promise.resolve();
  });

  Object.defineProperty(Element.prototype, 'requestFullscreen', {
    configurable: true,
    writable: true,
    value: request,
  });
  Object.defineProperty(document, 'exitFullscreen', {
    configurable: true,
    writable: true,
    value: exit,
  });
  Object.defineProperty(document, 'fullscreenElement', {
    configurable: true,
    get: () => current,
  });

  return { request, exit };
};

const uninstallFullscreenApi = () => {
  Reflect.deleteProperty(Element.prototype, 'requestFullscreen');
  Reflect.deleteProperty(document, 'exitFullscreen');
  Reflect.deleteProperty(document, 'fullscreenElement');
};

describe('the stage goes fullscreen', () => {
  afterEach(() => {
    uninstallFullscreenApi();
    document.body.innerHTML = '';
  });

  describe('where the browser has the API', () => {
    let api: ReturnType<typeof installFullscreenApi>;
    beforeEach(() => {
      api = installFullscreenApi();
    });

    it('asks for the element it was given, and reports it filled', () => {
      const ref = stageRef();
      const { result } = renderHook(() => useFullscreen(ref));

      expect(result.current.supported).toBe(true);
      expect(result.current.active).toBe(false);

      act(() => result.current.toggle());

      expect(api.request).toHaveBeenCalledTimes(1);
      expect(api.request.mock.instances[0] as unknown as Element).toBe(ref.current);
      expect(result.current.active).toBe(true);
    });

    it('gives the screen back', () => {
      const ref = stageRef();
      const { result } = renderHook(() => useFullscreen(ref));

      act(() => result.current.toggle());
      act(() => result.current.toggle());

      expect(api.exit).toHaveBeenCalledTimes(1);
      expect(result.current.active).toBe(false);
    });

    // Escape is the way most rowers will leave it, and it is a route the
    // toggle never hears about. Reading the state back from the event rather
    // than flipping it on click is what makes the button truthful afterwards.
    it('notices the screen being given back by something else', () => {
      const ref = stageRef();
      const { result } = renderHook(() => useFullscreen(ref));
      act(() => result.current.toggle());
      expect(result.current.active).toBe(true);

      act(() => {
        Object.defineProperty(document, 'fullscreenElement', {
          configurable: true,
          get: () => null,
        });
        document.dispatchEvent(new Event('fullscreenchange'));
      });

      expect(result.current.active).toBe(false);
    });

    // A request outside a user gesture rejects. It must not surface as an
    // unhandled rejection over a row in progress.
    it('survives the browser refusing', async () => {
      Object.defineProperty(Element.prototype, 'requestFullscreen', {
        configurable: true,
        writable: true,
        value: () => Promise.reject(new Error('not allowed')),
      });
      const ref = stageRef();
      const { result } = renderHook(() => useFullscreen(ref));

      act(() => result.current.toggle());
      await act(async () => { await Promise.resolve(); });

      expect(result.current.active).toBe(false);
    });
  });

  describe('where it does not (iOS Safari)', () => {
    it('falls back to a mode the page can style itself', () => {
      const ref = stageRef();
      const { result } = renderHook(() => useFullscreen(ref));

      expect(result.current.supported).toBe(false);

      act(() => result.current.toggle());
      expect(result.current.active).toBe(true);

      act(() => result.current.toggle());
      expect(result.current.active).toBe(false);
    });
  });

  it('does nothing at all before the stage has mounted', () => {
    const api = installFullscreenApi();
    const { result } = renderHook(() =>
      useFullscreen({ current: null } as React.RefObject<HTMLElement | null>),
    );

    act(() => result.current.toggle());

    expect(api.request).not.toHaveBeenCalled();
    expect(result.current.active).toBe(false);
  });
});
