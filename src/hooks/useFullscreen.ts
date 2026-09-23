import { useCallback, useEffect, useState, type RefObject } from 'react';

/**
 * Put one element - the row screen - fullscreen, and know whether it is (#335).
 *
 * `api` is the Fullscreen API. `css` is for where it cannot be used: iOS
 * Safari has no `requestFullscreen` on anything but a video, and a browser can
 * refuse a request (no user gesture, a permissions policy). There the page
 * lays the element over everything itself, which is most of the benefit - the
 * header and the page chrome are gone - without the browser's own bars hiding.
 */
export type FullscreenMode = 'api' | 'css';

export interface FullscreenControl {
  /** Whether the element is filling the screen, by either means. */
  active: boolean;
  /** How it does or would: the API until it turns out not to be available. */
  mode: FullscreenMode;
  toggle: () => Promise<void>;
}

export const useFullscreen = (ref: RefObject<HTMLElement | null>): FullscreenControl => {
  const [apiActive, setApiActive] = useState(false);
  const [cssActive, setCssActive] = useState(false);
  const [mode, setMode] = useState<FullscreenMode>('api');

  useEffect(() => {
    const onChange = () => setApiActive(!!ref.current && document.fullscreenElement === ref.current);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, [ref]);

  // The real thing leaves on Escape, so the stand-in does too.
  useEffect(() => {
    if (!cssActive) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setCssActive(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [cssActive]);

  const toggle = useCallback(async () => {
    const el = ref.current;
    if (!el) return;
    if (cssActive) {
      setCssActive(false);
      return;
    }
    if (document.fullscreenElement) {
      await document.exitFullscreen?.();
      return;
    }
    if (typeof el.requestFullscreen === 'function') {
      try {
        await el.requestFullscreen();
        return;
      } catch {
        // Refused; fall through to the page's own.
      }
    }
    setMode('css');
    setCssActive(true);
  }, [ref, cssActive]);

  return { active: apiActive || cssActive, mode, toggle };
};
