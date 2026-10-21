import { test, expect } from '../fixtures/crash-watch';

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
 * #562 P5 — flora LOD smoke. Loads `/smoke/flora` which mounts the engine
 * with a canned foliage set and asserts the P5 telemetry contract:
 *
 *   - `__ROWER3D_SCENERY.spriteDraws > 0` after one frame (sprite pass fired).
 *   - `__ROWER3D_SCENERY.solidDraws > 0` (solid pass fired).
 *   - `__ROWER3D_SCENERY.solidTriangles > 0` (triangle count propagated).
 *   - `__ROWER3D_TEXTURES.atlasKind` is one of {ktx2, png, placeholder}
 *     (the ktx2 decoder is stubbed to null today so it is 'png' or
 *     'placeholder' on the test runner).
 *
 * On a runner without a WebGPU adapter the fallback branch mirrors the
 * other smokes: `data-status === "unavailable"` and `__VIRTUALROW_WEBGPU_HEALTH`
 * publishes a fallback reason.
 */
test('webgpu flora LOD smoke', async ({ page }) => {
  await page.goto('./smoke/flora');
  const main = page.getByTestId('webgpu-flora-smoke');
  await expect(main).toBeVisible();

  const status = await main.getAttribute('data-status');
  if (status === 'ready') {
    const canvas = main.locator('canvas').first();
    await expect(canvas).toHaveAttribute('data-backend', 'webgpu');

    const scenery = await page.evaluate(
      () =>
        (window as unknown as {
          __ROWER3D_SCENERY?: {
            spriteDraws: number;
            solidDraws: number;
            solidTriangles: number;
            drawCount: number;
          };
        }).__ROWER3D_SCENERY,
    );
    expect(scenery?.spriteDraws).toBeGreaterThan(0);
    expect(scenery?.solidDraws).toBeGreaterThan(0);
    expect(scenery?.solidTriangles).toBeGreaterThan(0);

    const textures = await page.evaluate(
      () =>
        (window as unknown as {
          __ROWER3D_TEXTURES?: {
            atlasKind: string;
            atlasBytes: number;
            mipsGenerated: number;
          };
        }).__ROWER3D_TEXTURES,
    );
    expect(textures?.atlasKind).toMatch(/^(ktx2|png|placeholder|pending)$/);
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
