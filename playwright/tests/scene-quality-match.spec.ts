import { test, expect, type Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { expectSceneAlive } from '../utils/scene-health';

/**
 * The canvas and the scene must agree about quality.
 *
 * `isHighQuality` was `performanceMode !== 'low'`, and the default is `auto`,
 * so the canvas was always built for high quality — shadow maps, MSAA, device
 * pixel ratio up to 2, a request for the discrete adapter — while the scene
 * inside resolved the same `auto` against the real GPU and often chose `low`.
 *
 * A rower on an Intel UHD measured 891 ms frames from that mismatch, close
 * enough to Windows' GPU watchdog that the driver reset and the scene lasted
 * about a second at a time (#232).
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mockBluetoothPath = path.resolve(__dirname, '../mock-bluetooth.js');

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

async function rowTheDemoRoute(page: Page, mode?: 'low' | 'auto' | 'high') {
  if (mode) {
    await page.addInitScript((m) => {
      (
        window as unknown as { __VIRTUALROW_PERFORMANCE_MODE?: string }
      ).__VIRTUALROW_PERFORMANCE_MODE = m as string;
    }, mode);
  }
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
  // A visible container is not a rendering scene: it holds the fallback
  // marker too, which is what shows the context-lost banner.
  await expectSceneAlive(page, 'the quality tier scene');
  await expect
    .poll(() => page.evaluate(() => window.__ROWER3D_RENDER_STATS?.drawCalls ?? 0), {
      timeout: 60_000,
      intervals: [1000],
    })
    .toBeGreaterThan(0);
}

/**
 * The surface the app asked for, and — when the live context still has
 * attributes to give — what it actually got.
 *
 * Headless Chromium can lose the context under a high-quality scene, and a lost
 * context reports no attributes; the app's own decision is the thing under test
 * and is there either way.
 */
const ADAPTER_RANK = { 'low-power': 0, default: 1, 'high-performance': 2 } as const;

const canvasSurface = (page: Page) =>
  page.evaluate(() => {
    const canvas = document.querySelector('.rower3d-canvas-container canvas') as HTMLCanvasElement;
    const gl = canvas?.getContext('webgl2') as WebGL2RenderingContext | null;
    const attributes = gl?.getContextAttributes() ?? null;
    return {
      chosenAntialias: window.__ROWER3D_CONTEXT_STATE?.antialias ?? null,
      chosenPowerPreference: window.__ROWER3D_CONTEXT_STATE?.powerPreference ?? null,
      liveAntialias: attributes?.antialias ?? null,
      quality: window.__ROWER3D_RENDER_STATS?.performanceMode ?? null,
      // The app's decision, not the live canvas geometry: layout lags under
      // load, and a ratio measured mid-resize is noise, not a fault.
      maxDpr: window.__ROWER3D_CONTEXT_STATE?.maxDpr ?? null,
    };
  });

/** What each tier is allowed to ask the browser for. Mirrors canvasSurface.ts. */
const EXPECTED = {
  low: { antialias: false, adapter: 'low-power', maxDpr: 1 },
  auto: { antialias: true, adapter: 'default', maxDpr: 1.5 },
  high: { antialias: true, adapter: 'high-performance', maxDpr: 2 },
} as const;

for (const tier of ['low', 'auto', 'high'] as const) {
  test(`the ${tier} tier gets the surface the ${tier} tier is allowed`, async ({ page }) => {
    await rowTheDemoRoute(page, tier);

    const surface = await canvasSurface(page);

    expect(surface.quality).toBe(tier);
    expect(surface.chosenAntialias).toBe(EXPECTED[tier].antialias);
    // The probe may drop down a rung if the driver refuses, but it must never
    // climb above what the tier asked for.
    expect(ADAPTER_RANK[surface.chosenPowerPreference as keyof typeof ADAPTER_RANK]).toBeLessThanOrEqual(
      ADAPTER_RANK[EXPECTED[tier].adapter],
    );
    if (surface.liveAntialias !== null && !EXPECTED[tier].antialias) {
      expect(surface.liveAntialias).toBe(false);
    }
    expect(surface.maxDpr).toBeLessThanOrEqual(EXPECTED[tier].maxDpr);
  });
}

test('no tier draws at a higher pixel ratio or richer adapter than the one above it', async ({
  page,
}) => {
  const readings: Array<{ tier: string; adapter: number; dpr: number; antialias: number }> = [];

  for (const tier of ['low', 'auto', 'high'] as const) {
    const context = await page.context().newPage();
    await rowTheDemoRoute(context, tier);
    const surface = await canvasSurface(context);
    readings.push({
      tier,
      adapter: ADAPTER_RANK[surface.chosenPowerPreference as keyof typeof ADAPTER_RANK] ?? 0,
      dpr: surface.maxDpr ?? 0,
      antialias: surface.chosenAntialias ? 1 : 0,
    });
    await context.close();
  }

  for (const key of ['adapter', 'dpr', 'antialias'] as const) {
    const values = readings.map((r) => r[key]);
    expect(values, `${key} across ${readings.map((r) => r.tier).join(' → ')}`).toEqual(
      [...values].sort((a, b) => a - b),
    );
  }
});

test('the scene reports which renderer is drawing, not which was detected', async ({ page }) => {
  await rowTheDemoRoute(page, 'low');

  const drawing = await page.evaluate(() => window.__ROWER3D_RENDER_STATS?.drawing);

  // R3F builds a WebGL renderer whatever GPU detection preferred; the panel
  // saying "webgpu" sent a reader looking in the wrong place.
  expect(drawing).toBe('webgl');
});
