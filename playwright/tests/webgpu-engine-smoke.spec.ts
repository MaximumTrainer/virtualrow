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
 * #550 P2-AC4 / AC5 — the engine's one Playwright smoke, matching the engine
 * attach contract agreed with the UI thread. We mount a hidden `/smoke/engine`
 * route (not linked from any UI chrome) that calls `attach` on a bare canvas
 * with `testMode: true`, then read:
 *
 *   - `data-backend="webgpu"` on the canvas (set by `attach`).
 *   - `__ROWER3D_CONTEXT_STATE.kind === "ready"` (engine's telemetry contract).
 *   - `__ROWER3D_FORCE_RENDER()` increments the frame counter.
 *   - `__VIRTUALROW_WEBGPU_HEALTH` exists (either success or a published fallback).
 *
 * On a runner with no WebGPU adapter the status attribute reaches
 * `unavailable` and the fallback branch is checked. CI's SwiftShader WebGPU
 * is not reliably available; the webgpu-engine job is `continue-on-error`
 * until a real GPU runner is provisioned (D8-b).
 */
test('webgpu engine smoke', async ({ page }) => {
  await page.goto('./smoke/engine');
  const main = page.getByTestId('webgpu-engine-smoke');
  await expect(main).toBeVisible();

  const status = await main.getAttribute('data-status');
  if (status === 'ready') {
    const canvas = main.locator('canvas').first();
    await expect(canvas).toHaveAttribute('data-backend', 'webgpu');

    const context = await page.evaluate(
      () =>
        (window as unknown as {
          __ROWER3D_CONTEXT_STATE?: { kind: string; backend: string };
        }).__ROWER3D_CONTEXT_STATE,
    );
    expect(context?.kind).toBe('ready');
    expect(context?.backend).toBe('webgpu');

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

    // Guards the #549 black-canvas regression — pre-fix, every assertion
    // above still passed while every submitted command buffer was invalid.
    await assertCanvasNotBlank(page, canvas);
  } else {
    // Fallback: WebGPU isn't available on this runner. The engine refused to
    // attach and `__VIRTUALROW_WEBGPU_HEALTH` records the reason.
    const health = await page.evaluate(
      () =>
        (window as unknown as {
          __VIRTUALROW_WEBGPU_HEALTH?: { fallbackReason?: string };
        }).__VIRTUALROW_WEBGPU_HEALTH,
    );
    expect(health?.fallbackReason).toBeTruthy();
  }
});
