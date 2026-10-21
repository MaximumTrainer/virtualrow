import { describe, it, expect, vi, afterEach } from 'vitest';
import { flushSync } from 'svelte';

import { FullscreenStore } from '../lib/ui/fullscreen.svelte';

// The Fullscreen API is not in jsdom; define it per test and restore after so a
// leaked definition does not flip `supported` for a later shuffled test (#518).
afterEach(() => {
  Reflect.deleteProperty(document.documentElement, 'requestFullscreen');
  Reflect.deleteProperty(document, 'exitFullscreen');
  Reflect.deleteProperty(document, 'fullscreenElement');
});

describe('FullscreenStore', () => {
  it('without the Fullscreen API, toggle flips active and requests nothing', () => {
    const s = new FullscreenStore();
    const stop = $effect.root(() => {
      const off = s.bind(document.createElement('div'));
      expect(s.supported).toBe(false);
      expect(s.active).toBe(false);
      s.toggle();
      flushSync();
      expect(s.active).toBe(true);
      s.toggle();
      flushSync();
      expect(s.active).toBe(false);
      off();
    });
    stop();
  });

  it('with the API, toggle requests fullscreen and active follows the browser event', () => {
    const el = document.createElement('div');
    let fsEl: Element | null = null;
    Object.defineProperty(document.documentElement, 'requestFullscreen', {
      configurable: true,
      value: vi.fn(() => Promise.resolve()),
    });
    Object.defineProperty(document, 'exitFullscreen', {
      configurable: true,
      value: vi.fn(() => {
        fsEl = null;
        return Promise.resolve();
      }),
    });
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => fsEl });
    const request = vi.fn(() => {
      fsEl = el;
      return Promise.resolve();
    });
    Object.defineProperty(el, 'requestFullscreen', { configurable: true, value: request });

    const s = new FullscreenStore();
    const stop = $effect.root(() => {
      const off = s.bind(el);
      expect(s.supported).toBe(true);

      s.toggle();
      expect(request).toHaveBeenCalled();
      document.dispatchEvent(new Event('fullscreenchange'));
      flushSync();
      expect(s.active).toBe(true);

      s.toggle(); // now in fullscreen → exit
      document.dispatchEvent(new Event('fullscreenchange'));
      flushSync();
      expect(s.active).toBe(false);
      off();
    });
    stop();
  });

  it('toggle with no bound element does nothing', () => {
    Object.defineProperty(document.documentElement, 'requestFullscreen', {
      configurable: true,
      value: vi.fn(() => Promise.resolve()),
    });
    const s = new FullscreenStore();
    expect(() => s.toggle()).not.toThrow();
    expect(s.active).toBe(false);
  });
});
