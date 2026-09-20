// ============================================================================
// IS THE 3D SCENE ACTUALLY THERE?
//
// Playwright specs were passing while the stage showed
// "The 3D view lost the graphics context — restoring…". Eighteen of the
// twenty-one specs that drive the scene never checked for it, so a test could
// assert a canvas existed, telemetry was produced, or nothing threw — all of
// which are true of a scene showing an error banner instead of a river.
//
// The check lives here as a pure function so the rule is testable on its own
// and the same wording cannot drift apart between the app and the guard.
// ============================================================================

/** The banner the scene shows when its WebGL context goes. */
export const CONTEXT_LOST_TEXT = 'lost the graphics context';

/**
 * The words the rower actually sees, and the only place they are written.
 *
 * This module said it existed so "the app and the guard cannot drift apart on
 * the wording", and then the app hard-coded the sentence anyway - so the drift
 * it was meant to prevent was still entirely possible (#299). The guard matches
 * on CONTEXT_LOST_TEXT, which is a fragment of this, so a reworded message
 * cannot slip past it.
 */
export const CONTEXT_LOST_MESSAGE = 'The 3D view lost the graphics context — restoring…';

/**
 * What the rower sees once the app has stopped trying.
 *
 * The restore schedule is bounded - three attempts, the last at about 5.8 s -
 * and when it ran out the stage went on saying "restoring…" anyway. Probed on
 * the demo row, that promise was still on screen sixteen seconds later and
 * would have stayed for the session (#309).
 *
 * Two things the rower needs and the old message gave neither: that the row is
 * still being recorded, which it is - distance, time and heart rate never stop
 * - and the one action that brings the view back.
 *
 * It keeps the CONTEXT_LOST_TEXT fragment deliberately. `describeSceneHealth`
 * matches on that, so a scene showing this is still judged not alive; a
 * rewording that dropped it would let a dead scene pass the sweep, which is the
 * fault #299 fixed.
 */
export const CONTEXT_UNRECOVERABLE_MESSAGE =
  'The 3D view lost the graphics context and could not get it back — your row is '
  + 'still being recorded. Reload the page to get the view back.';

export interface SceneObservation {
  /**
   * Whether the canvas in the DOM right now reports a lost context.
   *
   * Asked of the live canvas rather than taken from
   * `window.__ROWER3D_WEBGL_LOST`, which is global and outlives the canvas that
   * set it: React mounts the Canvas twice under StrictMode, and a discarded
   * first canvas losing its context left that flag true for the rest of the
   * session even though the canvas on screen was fine.
   */
  contextLost: boolean;
  /** Text content of `.rower3d-fallback-marker`. */
  markerText: string;
  /** Canvases inside the 3D container. */
  canvasCount: number;
  /** The global flag, kept for the failure message only. */
  flagSet?: boolean;
  /** Per-canvas loss, so a failure says whether a discarded mount is to blame. */
  lostPerCanvas?: boolean[];
}

export interface SceneHealth {
  alive: boolean;
  reason: string;
}

/**
 * Whether what the page is showing is a rendering scene.
 *
 * Deliberately narrow: it does not judge what the scene contains, only that it
 * has not been replaced by the context-lost banner and that there is a canvas
 * to draw into. Content is a separate question, asked by
 * scene-contrast.spec.ts.
 */
export const describeSceneHealth = ({
  contextLost,
  markerText,
  canvasCount,
  flagSet,
  lostPerCanvas,
}: SceneObservation): SceneHealth => {
  if (canvasCount < 1) {
    return { alive: false, reason: 'there is no canvas in the 3D container' };
  }
  // The canvas on screen is the one most recently mounted; anything before it
  // is a mount React discarded, and its released context says nothing about
  // what the rower is looking at. Reducing the array with `some` put back the
  // very fault that asking a canvas instead of the global flag was meant to fix
  // (#299).
  const liveLost =
    lostPerCanvas && lostPerCanvas.length > 0
      ? lostPerCanvas[lostPerCanvas.length - 1]
      : contextLost;

  if (liveLost) {
    return {
      alive: false,
      reason:
        `the canvas on screen reports a lost WebGL context` +
        `${flagSet ? ' (and the global flag is set)' : ''}` +
        `; canvases=${canvasCount} lost=${JSON.stringify(lostPerCanvas ?? [])}`,
    };
  }
  if (markerText.toLowerCase().includes(CONTEXT_LOST_TEXT)) {
    return {
      alive: false,
      reason: `the stage is showing the context-lost banner: "${markerText.trim()}"`,
    };
  }
  return { alive: true, reason: 'scene is rendering' };
};
