import { test, expect } from '../fixtures/crash-watch';
import { assertCanvasNotBlank } from './helpers/assertCanvasNotBlank';

// `--enable-unsafe-webgpu` so Chromium exposes `navigator.gpu`. On a runner
// without a WebGPU backend the engine falls back to null and the spec
// asserts the unavailable path.
test.use({
  launchOptions: {
    args: [
      '--enable-unsafe-webgl',
      '--use-gl=swiftshader',
      '--enable-unsafe-swiftshader',
      '--enable-unsafe-webgpu',
      '--no-sandbox',
      '--disable-gpu-rasterization',
      '--disable-gpu-compositing',
      '--disable-dev-shm-usage',
    ],
  },
});

/**
 * #573 P8 AC7 — the post-fx smoke, modelled on the engine smoke. Mounts
 * `/smoke/postfx` which attaches the engine at tier `high` so bloom + ACES
 * + LUT + vignette + SSAO are all live, then asserts the engine reports
 * ready and `__ROWER3D_FORCE_RENDER()` ticks the frame counter.
 *
 * The post-fx job stays `continue-on-error` until a real GPU runner lands
 * (same posture as the engine + buildings smokes).
 */
test('webgpu post-fx smoke', async ({ page }) => {
  await page.goto('./smoke/postfx');
  const main = page.getByTestId('webgpu-postfx-smoke');
  await expect(main).toBeVisible();

  const status = await main.getAttribute('data-status');
  if (status === 'ready') {
    const canvas = main.locator('canvas').first();
    await expect(canvas).toHaveAttribute('data-backend', 'webgpu');

    const framesBefore = await page.evaluate(
      () =>
        (window as unknown as { __ROWER3D_FRAME_STATS?: { frame: number } })
          .__ROWER3D_FRAME_STATS?.frame ?? 0,
    );
    await page.evaluate(() =>
      (window as unknown as { __ROWER3D_FORCE_RENDER?: () => void }).__ROWER3D_FORCE_RENDER?.(),
    );
    const framesAfter = await page.evaluate(
      () =>
        (window as unknown as { __ROWER3D_FRAME_STATS?: { frame: number } })
          .__ROWER3D_FRAME_STATS?.frame ?? 0,
    );
    expect(framesAfter).toBeGreaterThan(framesBefore);
    // Guards the #549 black-canvas regression (see helper).
    await assertCanvasNotBlank(page, canvas);
  } else {
    const health = await page.evaluate(
      () =>
        (window as unknown as {
          __VIRTUALROW_WEBGPU_HEALTH?: { fallbackReason?: string };
        }).__VIRTUALROW_WEBGPU_HEALTH,
    );
    expect(health?.fallbackReason).toBeTruthy();
  }
});
