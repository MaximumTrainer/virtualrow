/**
 * Which of the four camera views the rower is looking through, and remembering
 * it (#328). Svelte-runes port of the retired React `useCameraView` hook.
 *
 * The key and the storage live together because they are one decision: a view
 * that cycles but is forgotten on reload is worse than no cycling at all, and
 * the cycle is the only way to reach the other views.
 */
import { isCameraView, nextView, type CameraView } from '../renderer/engine/camera';
export type { CameraView };

export const CAMERA_VIEW_STORAGE_KEY = 'virtualrow:camera-view';
/** The key that cycles the view. Lower-cased, so shift does not matter. */
export const CAMERA_VIEW_KEY = 'v';

const readStored = (): CameraView => {
  if (typeof localStorage === 'undefined') return 'chase';
  try {
    const stored = localStorage.getItem(CAMERA_VIEW_STORAGE_KEY);
    return isCameraView(stored) ? stored : 'chase';
  } catch {
    // Private windows and blocked site data both throw here rather than
    // returning null, and a camera is not worth failing a row over.
    return 'chase';
  }
};

const writeStored = (view: CameraView): void => {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(CAMERA_VIEW_STORAGE_KEY, view);
  } catch {
    // Remembering is a convenience; not remembering is not a failure.
  }
};

const isTypingTarget = (target: EventTarget | null): boolean => {
  const el = target as HTMLElement | null;
  if (!el) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
};

export class CameraViewStore {
  #view = $state<CameraView>(readStored());

  get view(): CameraView {
    return this.#view;
  }

  /** Move to the next view and remember it. */
  cycle = (): void => {
    const next = nextView(this.#view);
    this.#view = next;
    writeStored(next);
  };

  /** Set the view directly (test seam / future UI button). Unknown values no-op. */
  set(next: CameraView): void {
    if (!isCameraView(next)) return;
    this.#view = next;
    writeStored(next);
  }

  /**
   * Listen for the `V` key on `window` and cycle. Returns a teardown; call
   * from an `$effect` on the ride page so the listener leaves with the page.
   */
  bindKeyboard(): () => void {
    if (typeof window === 'undefined') return () => {};
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key.toLowerCase() !== CAMERA_VIEW_KEY) return;
      // Not while someone is typing: the view key is a single letter, and a
      // route name with a V in it should not move the camera.
      if (isTypingTarget(event.target)) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      this.cycle();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }
}
