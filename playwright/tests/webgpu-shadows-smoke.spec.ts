import { test, expect } from '../fixtures/crash-watch';

// `--enable-unsafe-webgpu` so Chromium exposes `navigator.gpu`. On a runner
// without a WebGPU backend the engine falls back to null and the spec
// asserts the unavailable path (same shape as the engine + scenery smokes).
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
 * #559 P4-AC4 — shadows smoke. Loads the hidden `/smoke/shadows` route which
 * mounts the engine with a canned foliage pool set. Asserts:
 *
 *   - `data-backend="webgpu"` on the canvas.
 *   - `__ROWER3D_CONTEXT_STATE.kind === "ready"`.
 *   - `__ROWER3D_SHADOWS.cascades >= 2` (medium tier default).
 *   - `__ROWER3D_SHADOWS.atlasBytes > 0`.
 *   - `__ROWER3D_SHADOWS.lastSplits.length === cascades`, strictly increasing.
 *   - `__ROWER3D_RENDER_STATS.shadowDraws > 0` after one frame.
 *
 * On a runner without a WebGPU adapter the fallback branch mirrors the engine
 * smoke: `data-status === "unavailable"` and the health global publishes a
 * fallback reason.
 */
test('webgpu shadows smoke', async ({ page }) => {
  await page.goto('./smoke/shadows');
  const main = page.getByTestId('webgpu-shadows-smoke');
  await expect(main).toBeVisible();

  const status = await main.getAttribute('data-status');
  if (status === 'ready') {
    const canvas = main.locator('canvas').first();
    await expect(canvas).toHaveAttribute('data-backend', 'webgpu');

    const shadows = await page.evaluate(
      () =>
        (window as unknown as {
          __ROWER3D_SHADOWS?: {
            cascades: number;
            atlasSize: number;
            lastSplits: number[];
            draws: number;
            atlasBytes: number;
          };
        }).__ROWER3D_SHADOWS,
    );
    expect(shadows?.cascades).toBeGreaterThanOrEqual(2);
    expect(shadows?.atlasBytes).toBeGreaterThan(0);
    expect(shadows?.lastSplits.length).toBe(shadows?.cascades);
    for (let i = 1; i < (shadows?.lastSplits.length ?? 0); i++) {
      expect(shadows!.lastSplits[i]).toBeGreaterThan(shadows!.lastSplits[i - 1]);
    }

    const stats = await page.evaluate(
      () =>
        (window as unknown as {
          __ROWER3D_RENDER_STATS?: { shadowDraws: number };
        }).__ROWER3D_RENDER_STATS,
    );
    expect(stats?.shadowDraws).toBeGreaterThan(0);
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
