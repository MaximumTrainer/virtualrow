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

    // Has the app created its own context yet?
    //
    // This gate is the whole reason the next block is safe. `getContext` is a
    // constructor, not a question: called on a canvas that has none, it makes
    // one — with default attributes — and every later call, three.js's included,
    // silently gets that context back with the attributes it asked for ignored.
    // R3F puts the <canvas> in the DOM on its first render and builds the
    // renderer later, behind a ResizeObserver and an await, so there is a real
    // window in which this guard could have created the scene's context for it:
    // antialias on where the low tier had asked for it off, and
    // preserveDrawingBuffer off, which would quietly empty every canvas
    // screenshot in the suite.
    //
    // __ROWER3D_GPU_BACKEND is set in onCreated, after three.js has made the
    // context, and unlike the other telemetry it is not gated on test mode - so
    // it works for the specs that deliberately run without the BLE harness.
    const rendererReady =
      (window as unknown as { __ROWER3D_GPU_BACKEND?: string }).__ROWER3D_GPU_BACKEND !==
      undefined;

    // Ask the canvas on screen, not the global flag. The flag outlives the
    // canvas that set it, and React mounts the Canvas twice under StrictMode —
    // a discarded first canvas losing its context left it true for the rest of
    // the session while the visible canvas was perfectly healthy.
    const lostPerCanvas = rendererReady
      ? canvases.map((canvas) => {
          try {
            // webgl2 only, and never a webgl1 fallback: on a machine without
            // webgl2 that fallback would create a webgl1 context, and three's
            // own webgl2 request would then fail and take the scene down.
            const gl = canvas.getContext('webgl2') as WebGL2RenderingContext | null;
            return gl ? gl.isContextLost() : false;
          } catch {
            return false;
          }
        })
      : [];
    const contextLost = lostPerCanvas.some(Boolean);

    return {
      contextLost,
      markerText: marker?.textContent ?? '',
      canvasCount: canvases.length,
      lostPerCanvas,
      rendererReady,
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
    .poll(
      async () => {
        const seen = await observe(page);
        return seen.canvasCount > 0 && seen.rendererReady;
      },
      {
        timeout: SCENE_READY_TIMEOUT_MS,
        message: `${context}: the 3D renderer never came up (no canvas, or three.js never created its context)`,
      },
    )
    .toBe(true);

  // Second: is that canvas showing a scene or an error? Asked once, with no
  // waiting. Polling here would quietly pass a context that was lost and later
  // restored — the rower still saw the banner, and a spec that waits for it to
  // go away is asserting that the fault is brief rather than that it is absent.
  const health = describeSceneHealth(await observe(page));

  expect(health.alive, `${context}: ${health.reason}`).toBe(true);
}

export { CONTEXT_LOST_TEXT };

/**
 * Watch the scene for a while, and fail at the first moment it drops out.
 *
 * {@link expectSceneAlive} asks once, which catches a scene that is broken when
 * a spec looks at it. It cannot catch a scene that comes up, draws the river,
 * and then loses its context part-way through a row - which is what rowers were
 * reporting, and what every spec sailed past: the assertions all ran inside the
 * first few seconds, and the fault arrived after them.
 *
 * Sampling, not one look at the end, because the context recovers: a check at
 * the end alone would see a healthy scene and say nothing about the seconds the
 * rower spent looking at the banner.
 */
export async function expectSceneAliveThroughout(
  page: Page,
  durationMs: number,
  context = 'the 3D scene',
): Promise<void> {
  await expectSceneAlive(page, context);

  const startedAt = Date.now();
  const deadline = startedAt + durationMs;
  while (Date.now() < deadline) {
    await page.waitForTimeout(250);
    const health = describeSceneHealth(await observe(page));
    if (!health.alive) {
      const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
      expect(
        health.alive,
        `${context}: the scene was lost ${elapsed}s into the row - ${health.reason}`,
      ).toBe(true);
    }
  }
}
