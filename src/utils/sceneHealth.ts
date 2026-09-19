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
