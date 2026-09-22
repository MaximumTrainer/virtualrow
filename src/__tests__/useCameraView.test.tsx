import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import {
  CAMERA_VIEW_STORAGE_KEY,
  useCameraView,
} from '../hooks/useCameraView';

/**
 * Issue #328 — the camera view is chosen, and remembered.
 *
 * A cycle that forgets on reload is worse than no cycle: the other three views
 * are only reachable through it, so a rower who prefers the bow view has to
 * find it again every session.
 */

const pressKey = (key: string, target: EventTarget = window) => {
  act(() => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  });
};

beforeEach(() => {
  localStorage.clear();
});

describe('useCameraView', () => {
  it('starts on the chase camera', () => {
    const { result } = renderHook(() => useCameraView());
    expect(result.current.view).toBe('chase');
  });

  it('cycles on V', () => {
    const { result } = renderHook(() => useCameraView());

    pressKey('v');
    expect(result.current.view).toBe('side');
    pressKey('v');
    expect(result.current.view).toBe('bow');
    pressKey('v');
    expect(result.current.view).toBe('high');
  });

  it('does not care about shift', () => {
    const { result } = renderHook(() => useCameraView());

    pressKey('V');
    expect(result.current.view).toBe('side');
  });

  it('remembers the choice', () => {
    const { result, unmount } = renderHook(() => useCameraView());
    pressKey('v');
    pressKey('v');
    expect(result.current.view).toBe('bow');
    unmount();

    const again = renderHook(() => useCameraView());
    expect(again.result.current.view, 'the view was forgotten on reload').toBe('bow');
  });

  it('starts from the chase camera when the stored value is from another build', () => {
    localStorage.setItem(CAMERA_VIEW_STORAGE_KEY, 'orbit');
    const { result } = renderHook(() => useCameraView());

    expect(result.current.view).toBe('chase');
  });

  it('cycles from the button as well as the key', () => {
    const { result } = renderHook(() => useCameraView());

    act(() => result.current.cycle());
    expect(result.current.view).toBe('side');
  });

  // A route named "Vesper Reach" is typed into a text field, and every V in it
  // would otherwise move the camera.
  it.each(['INPUT', 'TEXTAREA', 'SELECT'])('ignores V typed into a %s', (tag) => {
    const { result } = renderHook(() => useCameraView());
    const field = document.createElement(tag);
    document.body.appendChild(field);

    pressKey('v', field);

    expect(result.current.view).toBe('chase');
    field.remove();
  });

  it('ignores V with a modifier held, which belongs to the browser', () => {
    const { result } = renderHook(() => useCameraView());

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'v', ctrlKey: true }));
    });

    expect(result.current.view).toBe('chase');
  });

  it('stops listening once the scene is gone', () => {
    const { result, unmount } = renderHook(() => useCameraView());
    unmount();

    pressKey('v');

    expect(result.current.view).toBe('chase');
  });

  // Private windows and blocked site data throw from `localStorage` rather
  // than returning null, and a camera is not worth failing a row over.
  it('still cycles where storage is unavailable', () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });

    const { result } = renderHook(() => useCameraView());
    expect(result.current.view).toBe('chase');
    pressKey('v');
    expect(result.current.view).toBe('side');

    getItem.mockRestore();
    setItem.mockRestore();
  });
});
