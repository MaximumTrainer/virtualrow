/**
 * Putting one element on the whole screen, and knowing when it is (#335).
 *
 * The contract the Svelte row view needs from the fullscreen controller. It
 * lives in its own module (not a `.svelte` one) so `tsc` can import the type —
 * which it cannot do from a Svelte `<script module>` export — and so the
 * framework-free `src/lib` layer does not reach into a React hook for it. It
 * mirrors the shape the React `useFullscreen` hook returns.
 */
export interface FullscreenControl {
  /** Whether the element is filling the screen, by either route. */
  active: boolean;
  /** Ask for it, or give it back. */
  toggle: () => void;
  /** Whether the browser has the real thing, or the page has to fake it. */
  supported: boolean;
}
