import { test, expect, type Page } from '@playwright/test';

/**
 * Issue #197 — coverage for the 3D postprocessing path.
 *
 * Before this, `DynamicPostFx` was gated on `!IS_TEST_MODE && performanceMode !== 'low'`,
 * and both of those derived from `window.__PLAYWRIGHT_TESTING`. The effect stack
 * therefore never executed under automation: it was exempt from testing by
 * construction, and a fault in it could only ever be found in production.
 *
 * `__VIRTUALROW_PERFORMANCE_MODE` decouples the two, so these specs run the app
 * at `auto` — the mode real users get — while still being automated.
 *
 * These assertions hold on both a real GPU and a software renderer: on a GPU the
 * composer mounts, and where the context reports no attributes the guard drops
 * the effect stack deliberately. Either way nothing throws and the scene renders.
 */

/** Boot the app at a given performance mode, before the SPA initialises. */
async function bootAt(page: Page, mode: 'low' | 'auto' | 'high') {
  await page.addInitScript((m) => {
    (window as unknown as { __VIRTUALROW_PERFORMANCE_MODE?: string }).__VIRTUALROW_PERFORMANCE_MODE = m;
  }, mode);
}

/**
 * What the page saw while its WebGL context was alive.
 *
 * `frozen` goes true at the first `webglcontextlost`. Under software GL the
 * full effect stack loses the context after roughly ten seconds and the #197
 * TypeError then fires again on the re-init path — behaviour tracked
 * separately, and not what this spec is about. Freezing there keeps the
 * observation window to the mount itself.
 */
interface MountObservation {
  best: number;
  frames: number;
  boundaryShown: boolean;
  alphaErrors: string[];
  boundaryErrors: string[];
  frozen: boolean;
}

/**
 * Observe the mount from inside the page instead of across the wire.
 *
 * Executing the dev-mode Three.js module graph blocks the main thread for
 * seconds at a time — long enough on a Windows runner that a wall-clock
 * `expect.poll` can burn its whole budget without ever landing an evaluate
 * while the scene is up, and report a canvas that had in fact mounted. An
 * in-page sampler records what happened when it happened; the test reads the
 * record whenever the thread frees up.
 */
async function observeMount(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as {
      __ROWER3D_OBSERVED?: MountObservation;
      __ROWER3D_WEBGL_LOST?: boolean;
    };
    const observed: MountObservation = {
      best: 0,
      frames: 0,
      boundaryShown: false,
      alphaErrors: [],
      boundaryErrors: [],
      frozen: false,
    };
    w.__ROWER3D_OBSERVED = observed;

    // Frames are page time, not wall-clock: they stop while the main thread is
    // blocked and resume with it, which is the clock the effect stack mounts on.
    const tick = () => {
      if (!observed.frozen) observed.frames += 1;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);

    const seen: string[] = [];
    window.addEventListener('error', (e) => seen.push(String(e.message)));
    // The GPU error boundary reports through console.error.
    const original = console.error.bind(console);
    console.error = (...args: unknown[]) => {
      seen.push(args.map((a) => String(a)).join(' '));
      original(...args);
    };

    setInterval(() => {
      if (observed.frozen) return;
      if (w.__ROWER3D_WEBGL_LOST) {
        // Keep the last reading taken while the context was alive.
        observed.frozen = true;
        return;
      }
      const canvases = Array.from(
        document.querySelectorAll('.rower3d-canvas-container canvas'),
      ) as HTMLCanvasElement[];
      observed.best = canvases.reduce(
        (best, c) => Math.max(best, Math.min(c.width, c.height)),
        observed.best,
      );
      // Sticky: the boundary offers a Retry, so a reading taken after one
      // would otherwise erase the fact that it ever showed.
      observed.boundaryShown =
        observed.boundaryShown || /3D rendering error/i.test(document.body.innerText);
      observed.alphaErrors = seen.filter((e) => /reading 'alpha'/.test(e));
      observed.boundaryErrors = seen.filter((e) => /GPU Error Boundary/.test(e));
    }, 100);
  });
}

function readObservation(page: Page): Promise<MountObservation> {
  return page.evaluate(
    () =>
      (window as unknown as { __ROWER3D_OBSERVED: MountObservation }).__ROWER3D_OBSERVED,
  );
}

function collectErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    // The GPU error boundary reports through console.error.
    if (m.type() === 'error') errors.push(m.text());
  });
  return errors;
}

async function startDemoRow(page: Page) {
  await page.goto('./');
  await page.locator('.btn-try-demo').click();
  await expect(page.locator('.activity-view')).toBeVisible({ timeout: 20_000 });
}

test.describe('3D postprocessing', () => {
  test('mounts at auto without throwing, and the scene still renders', async ({ page }) => {
    await bootAt(page, 'auto');
    await observeMount(page);

    await startDemoRow(page);

    // Wait for the canvas to be up and the scene to have run frames on top of
    // it — #197 threw from EffectComposer.addPass, so the effect stack has to
    // have had its turn before the verdict means anything. Context loss ends
    // the window early; whatever was seen by then is what counts. The budget is
    // wall-clock and the main thread spends much of it blocked, so it buys far
    // less observation than its size suggests.
    await expect
      .poll(
        async () => {
          const o = await readObservation(page);
          return o.frozen || (o.best > 0 && o.frames >= 30);
        },
        { timeout: 60_000, message: 'the 3D scene never mounted a canvas and rendered into it' },
      )
      .toBe(true);

    const observed = await readObservation(page);
    expect(observed.best).toBeGreaterThan(0);

    // The boundary's fallback never replaced the scene.
    expect(observed.boundaryShown).toBe(false);

    // The specific fault from #197: EffectComposer.addPass reading .alpha off a
    // null getContextAttributes() result.
    expect(observed.alphaErrors).toEqual([]);
    // Nothing reached the GPU error boundary.
    expect(observed.boundaryErrors).toEqual([]);
  });

  test('degrades deliberately when the context reports no attributes', async ({ page }) => {
    await bootAt(page, 'auto');
    // Force the condition #197 hit in software GL: getContextAttributes() → null.
    await page.addInitScript(() => {
      for (const proto of [WebGLRenderingContext.prototype, WebGL2RenderingContext.prototype]) {
        proto.getContextAttributes = function getContextAttributes() { return null; };
      }
    });
    const errors = collectErrors(page);

    await startDemoRow(page);
    await page.waitForTimeout(6_000);

    // The guard turns a thrown TypeError into a deliberate skip.
    expect(errors.filter((e) => /reading 'alpha'/.test(e))).toEqual([]);
    expect(errors.filter((e) => /GPU Error Boundary/.test(e))).toEqual([]);

    // And the scene survives without its effect stack.
    await expect(page.locator('.activity-route-stage .rower3d-canvas-container canvas')).toBeVisible();
    await expect(page.getByText(/3D rendering error/i)).toHaveCount(0);
  });

  test('high mode raises no god-rays errors (#233)', async ({ page }) => {
    // High was the one tier this spec never booted, which is why #233 lived
    // here unseen: GodRaysEffect.update dereferences its light source every
    // frame, and the pass was handed a ref whose .current was null, so the
    // scene threw continuously on exactly the hardware capable enough to
    // resolve auto to high.
    //
    // Modelled on the auto test rather than added as a heavier one: the same
    // single demo row, the same observation window.
    await bootAt(page, 'high');
    const errors = collectErrors(page);

    await startDemoRow(page);
    await page.waitForTimeout(6_000);

    // Both faults are fixed at the source now — `parent` by #233 here, and the
    // EffectComposer `alpha` by #257 — so high mode is held to raising neither.
    expect(
      errors.filter((e) => /reading '(parent|alpha)'/.test(e)),
      'the effect stack threw on a null dereference',
    ).toEqual([]);

    // Whether the scene survives is a different question, and on a software
    // rasteriser #257 answers it: the EffectComposer `alpha` fault trips the
    // GPU error boundary at high, so the fallback replaces the scene for a
    // reason that has nothing to do with god rays. Asserted where that fault
    // does not fire; the `parent` check above is the #233 guard and holds
    // everywhere.
    const software = await page.evaluate(() => {
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
      if (!gl) return true;
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      const name = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : '';
      return /swiftshader|llvmpipe|software|angle \(google/i.test(name);
    });

    if (!software) {
      await expect(
        page.locator('.activity-route-stage .rower3d-canvas-container canvas'),
      ).toBeVisible();
      await expect(page.getByText(/3D rendering error/i)).toHaveCount(0);
    }
  });

  test('low mode still skips the effect stack entirely', async ({ page }) => {
    await bootAt(page, 'low');
    const errors = collectErrors(page);

    await startDemoRow(page);
    await page.waitForTimeout(4_000);

    expect(errors.filter((e) => /reading 'alpha'/.test(e))).toEqual([]);
    await expect(page.locator('.activity-route-stage .rower3d-canvas-container canvas')).toBeVisible();
  });
});
