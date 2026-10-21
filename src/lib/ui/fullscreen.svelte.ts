/**
 * Put one element on the whole screen, and know when it is (#335) — a Svelte 5
 * runes port of `src/hooks/useFullscreen.ts`.
 *
 * `active` is read back from `document.fullscreenElement` on every
 * `fullscreenchange` rather than assumed from the last toggle, because
 * fullscreen leaves by routes nothing here can see (Escape, the browser chrome,
 * another element taking it). iOS Safari has no Fullscreen API on anything but a
 * `<video>`, so there `toggle` flips `active` and the page hides its own chrome.
 *
 * The element is handed in through {@link bind} from the owning component's
 * `$effect` (the workout stage), so the store carries no DOM ref of its own.
 */
import type { FullscreenControl } from './fullscreenControl';

const hasFullscreenApi = (): boolean =>
  typeof document !== 'undefined' &&
  typeof document.documentElement?.requestFullscreen === 'function';

export class FullscreenStore implements FullscreenControl {
  #el: HTMLElement | null = null;
  #supported = hasFullscreenApi();
  #sync = () => {
    this.#active = document.fullscreenElement === this.#el;
  };

  #active = $state(false);

  get active(): boolean {
    return this.#active;
  }
  get supported(): boolean {
    return this.#supported;
  }

  /** Point the control at an element and listen for the browser's own changes.
   * Returns a teardown; call from an `$effect`. */
  bind(el: HTMLElement | null): () => void {
    this.#el = el;
    if (!this.#supported || typeof document === 'undefined') return () => {};
    document.addEventListener('fullscreenchange', this.#sync);
    return () => document.removeEventListener('fullscreenchange', this.#sync);
  }

  toggle = (): void => {
    const el = this.#el;
    if (!el) return;
    if (!this.#supported) {
      this.#active = !this.#active;
      return;
    }
    // Both reject rather than throw (a request outside a user gesture, an exit
    // with nothing to exit); the state is read back from the event either way.
    const settled = document.fullscreenElement ? document.exitFullscreen() : el.requestFullscreen();
    void Promise.resolve(settled).catch(() => undefined);
  };
}
