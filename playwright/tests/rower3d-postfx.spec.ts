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
    const errors = collectErrors(page);

    await startDemoRow(page);

    // Assert the backing store early. Under software GL the full effect stack
    // loses the WebGL context after roughly ten seconds (the app's own
    // `webglcontextlost` handler then flags __ROWER3D_WEBGL_LOST and swaps in
    // its marker), so a later read measures that, not the mount this test is
    // about. Tracked separately; a real GPU is unaffected.
    await expect
      .poll(
        async () =>
          page.evaluate(() => {
            const canvases = Array.from(
              document.querySelectorAll('.rower3d-canvas-container canvas'),
            ) as HTMLCanvasElement[];
            return canvases.reduce((best, c) => Math.max(best, Math.min(c.width, c.height)), 0);
          }),
        { timeout: 8_000, message: 'the 3D canvas never got a non-zero backing store' },
      )
      .toBeGreaterThan(0);

    // The boundary's fallback never replaced the scene.
    await expect(page.getByText(/3D rendering error/i)).toHaveCount(0);

    // The specific fault from #197: EffectComposer.addPass reading .alpha off a
    // null getContextAttributes() result.
    expect(errors.filter((e) => /reading 'alpha'/.test(e))).toEqual([]);
    // Nothing reached the GPU error boundary.
    expect(errors.filter((e) => /GPU Error Boundary/.test(e))).toEqual([]);
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

  test('low mode still skips the effect stack entirely', async ({ page }) => {
    await bootAt(page, 'low');
    const errors = collectErrors(page);

    await startDemoRow(page);
    await page.waitForTimeout(4_000);

    expect(errors.filter((e) => /reading 'alpha'/.test(e))).toEqual([]);
    await expect(page.locator('.activity-route-stage .rower3d-canvas-container canvas')).toBeVisible();
  });
});
