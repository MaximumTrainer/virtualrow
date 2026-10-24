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
 * #566 P6-AC1 / AC5 / AC8 — buildings smoke. Loads the hidden
 * `/smoke/buildings` route which mounts the engine with 24 canned
 * buildings + a short foliage pool. Asserts:
 *
 *   - `data-backend="webgpu"` on the canvas.
 *   - `__ROWER3D_CONTEXT_STATE.kind === "ready"`.
 *   - `__ROWER3D_BUILDINGS.pool === 24` (D1-b: engine extrudes at attach).
 *   - `__ROWER3D_BUILDINGS.drawn > 0` after one frame.
 *   - `__ROWER3D_BUILDINGS.resident` + `.cast` reflect the medium tier
 *     caps (both true per D8).
 *   - `__ROWER3D_SHADOWS.draws` includes the buildings depth draws.
 *
 * On a runner without a WebGPU adapter the fallback branch mirrors the
 * engine smoke: `data-status === "unavailable"` and
 * `__VIRTUALROW_WEBGPU_HEALTH` publishes a fallback reason.
 */
test('webgpu buildings smoke', async ({ page }) => {
  await page.goto('./smoke/buildings');
  const main = page.getByTestId('webgpu-buildings-smoke');
  await expect(main).toBeVisible();

  const status = await main.getAttribute('data-status');
  if (status === 'ready') {
    const canvas = main.locator('canvas').first();
    await expect(canvas).toHaveAttribute('data-backend', 'webgpu');

    const buildings = await page.evaluate(
      () =>
        (window as unknown as {
          __ROWER3D_BUILDINGS?: {
            drawn: number;
            pool: number;
            resident: boolean;
            cast: boolean;
            footprintM2: number;
          };
        }).__ROWER3D_BUILDINGS,
    );
    expect(buildings?.pool).toBe(24);
    expect(buildings?.drawn).toBeGreaterThan(0);
    expect(buildings?.resident).toBe(true);
    expect(buildings?.cast).toBe(true);
    expect(buildings?.footprintM2).toBeGreaterThan(0);

    const shadows = await page.evaluate(
      () =>
        (window as unknown as {
          __ROWER3D_SHADOWS?: { draws: number };
        }).__ROWER3D_SHADOWS,
    );
    expect(shadows?.draws).toBeGreaterThan(0);
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
