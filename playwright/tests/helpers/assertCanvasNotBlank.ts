import { expect, type Locator, type Page } from '@playwright/test';

/**
 * Assert the WebGPU engine actually drew something to the canvas.
 *
 * The existing smoke specs assert `data-backend="webgpu"` and that the frame
 * counter advances on `__ROWER3D_FORCE_RENDER()`. Both of those passed while
 * the canvas rendered pure black (#549 regression): the engine attached, the
 * frame loop ran, `queue.submit` was called every frame, but every lit pass
 * failed WebGPU validation on bind-group size (`frame-uniforms` was 256 B,
 * the WGSL `Frame` struct needed 272 B). Chromium discards every invalid
 * command buffer silently and the swap-chain comes out all zeros.
 *
 * This helper closes that gap. After the frame loop has driven at least one
 * draw, it reads back the canvas pixels into a 2-D canvas (same-origin, so
 * `drawImage` + `getImageData` are allowed) and asserts a minimum share of
 * sampled pixels are above a brightness floor. Not every pixel — a scene
 * can legitimately be dim at the edges — but black-everywhere trips it.
 *
 * Only called when the engine has reported ready (`backend === 'webgpu'`),
 * never on the fallback path where no WebGPU adapter is available.
 */

export interface AssertCanvasNotBlankOptions {
  /**
   * Fraction of sampled pixels that must have R+G+B above the floor.
   * Default 0.2 (20 %) — generous so a mostly-dark but non-black scene
   * (e.g. the postfx smoke with an unlit test rig) still passes.
   */
  minNonBlankShare?: number;
  /** Minimum R+G+B sum (0..765) to count a pixel as non-blank. Default 15. */
  minBrightness?: number;
  /** Sample grid resolution (NxN). Default 20 → 400 samples. */
  gridSize?: number;
}

export async function assertCanvasNotBlank(
  page: Page,
  canvas: Locator,
  opts: AssertCanvasNotBlankOptions = {},
): Promise<void> {
  const minShare = opts.minNonBlankShare ?? 0.2;
  const minBrightness = opts.minBrightness ?? 15;
  const grid = opts.gridSize ?? 20;

  // Drive one more render so the swap-chain holds a presented frame at the
  // moment we read it back; without this the readback can race the present.
  await page.evaluate(() =>
    (window as unknown as { __ROWER3D_FORCE_RENDER?: () => void }).__ROWER3D_FORCE_RENDER?.(),
  );

  const sampled = await canvas.evaluate(
    (el, { grid: g, minBrightness: mb }) => {
      const c = el as HTMLCanvasElement;
      const w = c.width;
      const h = c.height;
      const tmp = document.createElement('canvas');
      tmp.width = w;
      tmp.height = h;
      const ctx = tmp.getContext('2d');
      if (!ctx) return { total: 0, nonBlank: 0, w, h, error: 'no-2d-context' as const };
      try {
        ctx.drawImage(c, 0, 0);
      } catch (err) {
        return {
          total: 0,
          nonBlank: 0,
          w,
          h,
          error: (err instanceof Error ? err.message : String(err)) as string,
        };
      }
      let total = 0;
      let nonBlank = 0;
      for (let yi = 0; yi < g; yi += 1) {
        for (let xi = 0; xi < g; xi += 1) {
          const x = Math.floor(((xi + 0.5) / g) * w);
          const y = Math.floor(((yi + 0.5) / g) * h);
          const d = ctx.getImageData(x, y, 1, 1).data;
          total += 1;
          if (d[0] + d[1] + d[2] >= mb) nonBlank += 1;
        }
      }
      return { total, nonBlank, w, h };
    },
    { grid, minBrightness },
  );

  expect(sampled, 'canvas readback should succeed').toMatchObject({ error: undefined });
  const share = sampled.total === 0 ? 0 : sampled.nonBlank / sampled.total;
  expect(
    share,
    `expected ≥${(minShare * 100).toFixed(0)}% of ${sampled.total} sampled pixels to be ` +
      `non-black (R+G+B ≥ ${minBrightness}); got ${sampled.nonBlank}/${sampled.total}. ` +
      `Canvas ${sampled.w}×${sampled.h}. A black canvas means lit passes submitted ` +
      `invalid command buffers (see helper comment).`,
  ).toBeGreaterThanOrEqual(minShare);
}
