import { expect, type Page } from '@playwright/test';
import { describeSceneHealth, CONTEXT_LOST_TEXT } from '../../src/utils/sceneHealth';

/**
 * Fail a spec that is passing while the 3D scene is not there.
 *
 * Specs were asserting a canvas existed, telemetry was produced, or nothing
 * threw — all true of a stage showing
 * "The 3D view lost the graphics context — restoring…" instead of a river.
 *
 * Call this in any spec that claims the scene works. The one exception is
 * webgl-context-recovery.spec.ts, which causes the loss deliberately and
 * asserts the recovery.
 */

/**
 * How long the scene has to come up.
 *
 * The canvas mounts after the view around it — the 3D bundle is lazy, and the
 * first frame follows the route geometry. Judged the instant `.activity-view`
 * appeared, this reported "there is no canvas" 326 times across CI: an
 * assertion racing the mount, not a defect. It waits now, and a context that is
 * lost and never restored still fails, because the wait ends.
 */
const SCENE_READY_TIMEOUT_MS = 25_000;

async function observe(page: Page) {
  return page.evaluate(() => {
    const marker = document.querySelector('.rower3d-fallback-marker');
    const canvases = Array.from(
      document.querySelectorAll('.rower3d-canvas-container canvas'),
    ) as HTMLCanvasElement[];

    // Ask the canvas on screen, not the global flag. The flag outlives the
    // canvas that set it, and React mounts the Canvas twice under StrictMode —
    // a discarded first canvas losing its context left it true for the rest of
    // the session while the visible canvas was perfectly healthy.
    const contextLost = canvases.some((canvas) => {
      try {
        const gl = (canvas.getContext('webgl2') ?? canvas.getContext('webgl')) as
          | WebGLRenderingContext
          | null;
        return gl ? gl.isContextLost() : false;
      } catch {
        return false;
      }
    });

    return {
      contextLost,
      markerText: marker?.textContent ?? '',
      canvasCount: canvases.length,
      flagSet:
        (window as unknown as { __ROWER3D_WEBGL_LOST?: boolean }).__ROWER3D_WEBGL_LOST === true,
    };
  });
}

export async function expectSceneAlive(page: Page, context = 'the 3D scene'): Promise<void> {
  // Two separate questions, deliberately not merged.
  //
  // First: has the canvas mounted? That is a race — the 3D bundle is lazy and
  // the first frame follows the route geometry — so it is waited for. Judged
  // instantly this reported "there is no canvas" 326 times across CI, which was
  // the assertion outrunning the mount rather than a defect.
  await expect
    .poll(async () => (await observe(page)).canvasCount, {
      timeout: SCENE_READY_TIMEOUT_MS,
      message: `${context}: no canvas ever mounted in the 3D container`,
    })
    .toBeGreaterThan(0);

  // Second: is that canvas showing a scene or an error? Asked once, with no
  // waiting. Polling here would quietly pass a context that was lost and later
  // restored — the rower still saw the banner, and a spec that waits for it to
  // go away is asserting that the fault is brief rather than that it is absent.
  const health = describeSceneHealth(await observe(page));

  expect(health.alive, `${context}: ${health.reason}`).toBe(true);
}

export { CONTEXT_LOST_TEXT };
