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
  if (contextLost) {
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
