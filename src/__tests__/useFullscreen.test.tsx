import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useFullscreen } from '../hooks/useFullscreen';

/**
 * Issue #335 — the row screen can fill the display.
 *
 * The Fullscreen API where there is one, and on iOS Safari, which has none for
 * an arbitrary element, a CSS mode the page lays out itself.
 */

const setFullscreenElement = (el: Element | null) => {
  Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => el });
};

afterEach(() => {
  setFullscreenElement(null);
  delete (document as { exitFullscreen?: unknown }).exitFullscreen;
});

describe('useFullscreen', () => {
  it('asks the browser to put the element fullscreen, and follows it there', async () => {
    const el = document.createElement('div');
    el.requestFullscreen = vi.fn(() => {
      setFullscreenElement(el);
      document.dispatchEvent(new Event('fullscreenchange'));
      return Promise.resolve();
    });
    const { result } = renderHook(() => useFullscreen({ current: el }));

    expect(result.current.active).toBe(false);
    expect(result.current.mode).toBe('api');
    await act(() => result.current.toggle());

    expect(el.requestFullscreen).toHaveBeenCalledTimes(1);
    expect(result.current.active).toBe(true);
  });

  it('leaves fullscreen on a second toggle', async () => {
    const el = document.createElement('div');
    el.requestFullscreen = vi.fn(() => Promise.resolve());
    setFullscreenElement(el);
    const exit = vi.fn(() => {
      setFullscreenElement(null);
      document.dispatchEvent(new Event('fullscreenchange'));
      return Promise.resolve();
    });
    document.exitFullscreen = exit;
    const { result } = renderHook(() => useFullscreen({ current: el }));

    await act(() => result.current.toggle());

    expect(exit).toHaveBeenCalledTimes(1);
    expect(el.requestFullscreen).not.toHaveBeenCalled();
    expect(result.current.active).toBe(false);
  });

  it('falls back to a CSS mode when the element cannot go fullscreen', async () => {
    // iOS Safari: no requestFullscreen on anything but a <video>.
    const el = document.createElement('div');
    Object.defineProperty(el, 'requestFullscreen', { value: undefined });
    const { result } = renderHook(() => useFullscreen({ current: el }));

    await act(() => result.current.toggle());
    expect(result.current.mode).toBe('css');
    expect(result.current.active).toBe(true);
    await act(() => result.current.toggle());
    expect(result.current.active).toBe(false);
  });

  it('leaves the CSS mode on Escape, as the real thing does', async () => {
    const el = document.createElement('div');
    Object.defineProperty(el, 'requestFullscreen', { value: undefined });
    const { result } = renderHook(() => useFullscreen({ current: el }));

    await act(() => result.current.toggle());
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(result.current.active).toBe(false);
  });

  it('falls back to the CSS mode when the browser refuses the request', async () => {
    // A request the browser turns down (no user gesture, a permissions policy)
    // still gets the rower a bigger stage.
    const el = document.createElement('div');
    el.requestFullscreen = vi.fn(() => Promise.reject(new TypeError('denied')));
    const { result } = renderHook(() => useFullscreen({ current: el }));

    await act(() => result.current.toggle());

    expect(result.current.active).toBe(true);
    expect(result.current.mode).toBe('css');
  });

  it('is inactive when something else is fullscreen', () => {
    const el = document.createElement('div');
    el.requestFullscreen = vi.fn(() => Promise.resolve());
    const { result } = renderHook(() => useFullscreen({ current: el }));

    act(() => {
      setFullscreenElement(document.createElement('video'));
      document.dispatchEvent(new Event('fullscreenchange'));
    });

    expect(result.current.active).toBe(false);
  });

  it('does nothing without an element', async () => {
    const { result } = renderHook(() => useFullscreen({ current: null }));
    await act(() => result.current.toggle());
    expect(result.current.active).toBe(false);
  });
});
