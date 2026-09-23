import { useCallback, useEffect, useState } from 'react';

/**
 * Put one element on the whole screen, and know when it is (#335).
 *
 * `active` is not a flag this hook sets and trusts. Fullscreen leaves by routes
 * nothing here can see - Escape, the browser's own chrome, another element
 * taking it - so the state is read back from `document.fullscreenElement` on
 * every `fullscreenchange` rather than assumed from the last toggle.
 *
 * iOS Safari has no Fullscreen API on anything but a <video>, and that is the
 * device most likely to be propped against an erg. There `toggle` flips
 * `active` and nothing else: the page reads it and hides its own chrome, which
 * is not real fullscreen but is the whole of what a rower wanted from it.
 */
export interface FullscreenControl {
  /** Whether the element is filling the screen, by either route. */
  active: boolean;
  /** Ask for it, or give it back. */
  toggle: () => void;
  /** Whether the browser has the real thing, or the page has to fake it. */
  supported: boolean;
}

const hasFullscreenApi = (): boolean =>
  typeof document !== 'undefined' && typeof document.documentElement?.requestFullscreen === 'function';

export const useFullscreen = (ref: React.RefObject<HTMLElement | null>): FullscreenControl => {
  const [active, setActive] = useState(false);
  const supported = hasFullscreenApi();

  useEffect(() => {
    // Nothing to listen to without the API, and subscribing anyway would mean
    // an event the browser never fires clearing the CSS fallback's own state.
    if (!supported) return;
    const sync = () => setActive(document.fullscreenElement === ref.current);
    document.addEventListener('fullscreenchange', sync);
    return () => document.removeEventListener('fullscreenchange', sync);
  }, [ref, supported]);

  const toggle = useCallback(() => {
    const element = ref.current;
    if (!element) return;

    if (!supported) {
      setActive((wasActive) => !wasActive);
      return;
    }

    // Both of these reject rather than throw - a request outside a user
    // gesture, an exit when there is nothing to exit - and an unhandled
    // rejection in a click handler is a console error on a screen a rower is
    // looking at. The state is read back from the event either way, so there
    // is nothing to do with the failure but decline to crash on it.
    const settled = document.fullscreenElement
      ? document.exitFullscreen()
      : element.requestFullscreen();
    void Promise.resolve(settled).catch(() => undefined);
  }, [ref, supported]);

  return { active, toggle, supported };
};
