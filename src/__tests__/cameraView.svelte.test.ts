import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

import {
  CameraViewStore,
  CAMERA_VIEW_STORAGE_KEY,
  CAMERA_VIEW_KEY,
} from '../lib/ui/cameraView.svelte';

/**
 * #328 (restored post-React cutover) — the camera view is chosen, and
 * remembered. A cycle that forgets on reload is worse than no cycle: the other
 * three views are only reachable through it, so a rower who prefers the bow
 * view would otherwise have to find it again every session.
 */

const pressKey = (
  key: string,
  options: { target?: EventTarget; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean } = {},
): void => {
  const target = options.target ?? window;
  target.dispatchEvent(
    new KeyboardEvent('keydown', {
      key,
      bubbles: true,
      ctrlKey: options.ctrlKey ?? false,
      metaKey: options.metaKey ?? false,
      altKey: options.altKey ?? false,
    }),
  );
};

describe('CameraViewStore', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('starts on the chase camera', () => {
    expect(new CameraViewStore().view).toBe('chase');
  });

  it('cycles chase → side → bow → high → chase on cycle()', () => {
    const store = new CameraViewStore();
    store.cycle();
    expect(store.view).toBe('side');
    store.cycle();
    expect(store.view).toBe('bow');
    store.cycle();
    expect(store.view).toBe('high');
    store.cycle();
    expect(store.view).toBe('chase');
  });

  it('remembers the choice across reloads', () => {
    const first = new CameraViewStore();
    first.cycle();
    first.cycle();
    expect(first.view).toBe('bow');
    expect(localStorage.getItem(CAMERA_VIEW_STORAGE_KEY)).toBe('bow');

    const second = new CameraViewStore();
    expect(second.view).toBe('bow');
  });

  it('falls back to chase when the stored value is from another build', () => {
    localStorage.setItem(CAMERA_VIEW_STORAGE_KEY, 'orbit');
    expect(new CameraViewStore().view).toBe('chase');
  });

  it('set() accepts a known view and rejects an unknown one', () => {
    const store = new CameraViewStore();
    store.set('bow');
    expect(store.view).toBe('bow');
    expect(localStorage.getItem(CAMERA_VIEW_STORAGE_KEY)).toBe('bow');
    // Unknown value no-ops.
    store.set('orbit' as unknown as 'chase');
    expect(store.view).toBe('bow');
  });

  describe('bindKeyboard()', () => {
    let teardown: () => void = () => {};
    afterEach(() => teardown());

    it('cycles on lower-case V', () => {
      const store = new CameraViewStore();
      teardown = store.bindKeyboard();
      pressKey(CAMERA_VIEW_KEY);
      expect(store.view).toBe('side');
    });

    it('does not care about shift (upper-case V still cycles)', () => {
      const store = new CameraViewStore();
      teardown = store.bindKeyboard();
      pressKey('V');
      expect(store.view).toBe('side');
    });

    it('ignores V with a modifier held — that belongs to the browser', () => {
      const store = new CameraViewStore();
      teardown = store.bindKeyboard();
      pressKey('v', { ctrlKey: true });
      pressKey('v', { metaKey: true });
      pressKey('v', { altKey: true });
      expect(store.view).toBe('chase');
    });

    it.each(['INPUT', 'TEXTAREA', 'SELECT'])('ignores V typed into a %s', (tag) => {
      const store = new CameraViewStore();
      teardown = store.bindKeyboard();
      const field = document.createElement(tag);
      document.body.appendChild(field);
      pressKey('v', { target: field });
      expect(store.view).toBe('chase');
      field.remove();
    });

    it('ignores V typed into a contenteditable element', () => {
      const store = new CameraViewStore();
      teardown = store.bindKeyboard();
      const div = document.createElement('div');
      // jsdom does not reflect contentEditable → isContentEditable, so stub the
      // getter directly — the production code only reads the property, which is
      // what the guard checks on a real contenteditable element in a browser.
      Object.defineProperty(div, 'isContentEditable', { value: true });
      document.body.appendChild(div);
      pressKey('v', { target: div });
      expect(store.view).toBe('chase');
      div.remove();
    });

    it('stops listening once the teardown runs', () => {
      const store = new CameraViewStore();
      const stop = store.bindKeyboard();
      stop();
      teardown = () => {};
      pressKey('v');
      expect(store.view).toBe('chase');
    });
  });

  it('still cycles where localStorage throws', () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    try {
      const store = new CameraViewStore();
      expect(store.view).toBe('chase');
      store.cycle();
      expect(store.view).toBe('side');
    } finally {
      getItem.mockRestore();
      setItem.mockRestore();
    }
  });
});
