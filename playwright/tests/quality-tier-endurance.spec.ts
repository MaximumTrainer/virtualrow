import { test, expect, type Page } from '../fixtures/crash-watch';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { expectSceneAlive } from '../utils/scene-health';

/**
 * Every tier has to keep drawing, not just start drawing.
 *
 * A rower could run `low` and `high` but `auto` died about a second in. `low`
 * mounts no composer and `high`'s god-rays pass throws every frame and aborts
 * before the expensive work completes (#233) — so `auto` was the only tier
 * whose full chain ran, and the SSAO normal pass in it hung the GPU until
 * Windows reset the driver and took the context with it.
 *
 * Starting is not the property that was broken; surviving is.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mockBluetoothPath = path.resolve(__dirname, '../mock-bluetooth.js');

/** Long enough to cover the "crashed after a second" window with room to spare. */
const ENDURANCE_MS = 12_000;

/**
 * True when the page is drawing through a software rasteriser.
 *
 * Same caveat the #224 budget spec records: SwiftShader is one to two orders of
 * magnitude slower than the weakest GPU this is written for, so liveness over a
 * fixed window says nothing there. Losing the context, on the other hand, is a
 * fault anywhere.
 */
async function isSoftwareRendered(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    try {
      const gl = document.createElement('canvas').getContext('webgl2') as WebGL2RenderingContext | null;
      if (!gl) return true;
      const info = gl.getExtension('WEBGL_debug_renderer_info');
      const name = String(info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : '');
      return /swiftshader|llvmpipe|software|angle \(google/i.test(name);
    } catch {
      return true;
    }
  });
}

async function waitForDeviceConnected(page: Page, deviceLabel: string) {
  await page.waitForFunction(
    (label) => {
      const containers = Array.from(document.querySelectorAll('.bluetooth-device-container'));
      const target = containers.find((c) =>
        c.querySelector('.device-name')?.textContent?.includes(label),
      );
      return target?.querySelector('.device-status')?.textContent?.includes('Connected') ?? false;
    },
    deviceLabel,
    { timeout: 10_000 },
  );
}

async function rowAt(page: Page, mode: 'low' | 'auto' | 'high') {
  await page.addInitScript((m) => {
    (
      window as unknown as { __VIRTUALROW_PERFORMANCE_MODE?: string }
    ).__VIRTUALROW_PERFORMANCE_MODE = m as string;
  }, mode);
  await page.addInitScript({ content: fs.readFileSync(mockBluetoothPath, 'utf8') });
  await page.goto('./');

  await page.getByRole('button', { name: 'Connect PM5', exact: true }).click();
  await waitForDeviceConnected(page, 'Concept2 PM5');
  await page.evaluate(() => {
    const containers = Array.from(document.querySelectorAll('.bluetooth-device-container'));
    const hr = containers.find((c) =>
      c.querySelector('.device-name')?.textContent?.includes('Heart Rate Monitor'),
    );
    (hr?.querySelector('button.btn-connect') as HTMLButtonElement)?.click();
  });
  await waitForDeviceConnected(page, 'Heart Rate Monitor');
  await expect(page.locator('.btn-start-workout')).toBeEnabled({ timeout: 10_000 });
  await page.evaluate(() => {
    (document.querySelector('.btn-start-workout') as HTMLButtonElement)?.click();
  });
  await expect(page.locator('.rower3d-canvas-container')).toBeVisible({ timeout: 30_000 });
  await expectSceneAlive(page, 'the tier scene');
  await expect
    .poll(() => page.evaluate(() => window.__ROWER3D_RENDER_STATS?.sampledAt ?? 0), {
      timeout: 60_000,
      intervals: [1000],
    })
    .toBeGreaterThan(0);
}

for (const tier of ['low', 'auto', 'high'] as const) {
  test(`the ${tier} tier keeps drawing and keeps its context`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));

    await rowAt(page, tier);
    const started = await page.evaluate(() => window.__ROWER3D_RENDER_STATS?.sampledAt ?? 0);

    await page.waitForTimeout(ENDURANCE_MS);

    const after = await page.evaluate(() => ({
      sampledAt: window.__ROWER3D_RENDER_STATS?.sampledAt ?? 0,
      context: window.__ROWER3D_CONTEXT_STATE,
      drawCalls: window.__ROWER3D_RENDER_STATS?.drawCalls ?? 0,
    }));

    const software = await isSoftwareRendered(page);
    console.log(
      `[${tier}] draw calls ${after.drawCalls}, losses ${after.context?.losses ?? 0}, ` +
        `errors ${errors.length}, software ${software}`,
    );

    // The fault being guarded: the GPU gives up and the context goes. That is a
    // fault on any renderer, so it is asserted everywhere.
    expect(after.context?.losses ?? 0, 'the context was lost').toBe(0);
    expect(after.context?.lost ?? false, 'the context is gone').toBe(false);

    // Still drawing. Only meaningful where frames take milliseconds rather than
    // seconds, so it is skipped on a software rasteriser — the same line the
    // #224 budget spec draws.
    if (!software) {
      expect(after.sampledAt, 'the render loop stopped').toBeGreaterThan(started);
    }

    // Both former exceptions are fixed at the source — `parent` by #233, the
    // EffectComposer `alpha` by #257 — so this is unconditional again.
    expect(errors, 'the scene raised errors').toEqual([]);
  });
}
