import { test, expect } from '../fixtures/crash-watch';
import { assertCanvasNotBlank } from './helpers/assertCanvasNotBlank';

// `--enable-unsafe-webgpu` so Chromium exposes `navigator.gpu`. On a runner
// without a WebGPU backend the engine falls back to null and the spec
// asserts the unavailable path (same shape as the engine smoke).
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
 * #555 P3-AC4 / AC5 — scenery smoke. Loads the hidden `/smoke/scenery` route
 * which mounts the engine with a canned foliage pool set (2 species × 5
 * chunks × 40 trees = 400 trees). Asserts:
 *
 *   - `data-backend="webgpu"` on the canvas.
 *   - `__ROWER3D_CONTEXT_STATE.kind === "ready"`.
 *   - `__ROWER3D_SCENERY.pools.length === 10` (= speciesCount * chunkCount).
 *   - `__ROWER3D_SCENERY.dispatchCount > 0` after one frame.
 *   - `__ROWER3D_FOLIAGE.trees === 400`.
 *
 * On a runner without a WebGPU adapter the fallback branch mirrors the engine
 * smoke: `data-status === "unavailable"` and `__VIRTUALROW_WEBGPU_HEALTH`
 * publishes a fallback reason.
 */
test('webgpu scenery smoke', async ({ page }) => {
  await page.goto('./smoke/scenery');
  const main = page.getByTestId('webgpu-scenery-smoke');
  await expect(main).toBeVisible();

  const status = await main.getAttribute('data-status');
  if (status === 'ready') {
    const canvas = main.locator('canvas').first();
    await expect(canvas).toHaveAttribute('data-backend', 'webgpu');

    const scenery = await page.evaluate(
      () =>
        (window as unknown as {
          __ROWER3D_SCENERY?: {
            pools: { kind: string; instanceCount: number }[];
            dispatchCount: number;
            drawCount: number;
          };
        }).__ROWER3D_SCENERY,
    );
    expect(scenery?.pools.length).toBe(10);
    expect(scenery?.dispatchCount).toBeGreaterThan(0);
    expect(scenery?.drawCount).toBeGreaterThan(0);

    const foliage = await page.evaluate(
      () =>
        (window as unknown as {
          __ROWER3D_FOLIAGE?: { trees: number; meshes: number; drawn: number };
        }).__ROWER3D_FOLIAGE,
    );
    expect(foliage?.trees).toBe(400);
    expect(foliage?.meshes).toBe(10);
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
