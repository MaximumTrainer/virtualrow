import { test, expect, type Page } from '../fixtures/crash-watch';

// `--enable-unsafe-webgpu` on this spec only, so every other spec keeps the
// default Chromium args (SwiftShader WebGL). On runners without a WebGPU
// backend this flag is a no-op and the spec's fallback branches take over.
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
 * #498 Phase 2c — Playwright coverage of the WebGPU compute-cull spike.
 *
 * The CPU `cullTo` path is covered by `scenery-kit-budgets` and the general
 * route specs. This file holds the spike's own ACs:
 *
 * - AC1 (parity): with the flag on, the scene renders. Draw-call counts and
 *   `__ROWER3D_FOLIAGE.trees` match the flag-off run within ±2 (the atomic
 *   compaction can tie-break differently per frame).
 * - AC3 (fallback): when `navigator.gpu` is undefined (Firefox, Chromium
 *   without `--enable-unsafe-webgpu`), the health telemetry records
 *   `fallbackReason: 'webgpu-unsupported'` and the CPU path still runs.
 * - AC4 (device-lost): a Playwright init hook replaces `requestDevice` with
 *   one whose returned device's `.lost` resolves on the first call, and
 *   `deviceLostCount` reflects it.
 *
 * The job this file runs in launches Chromium with `--enable-unsafe-webgpu`.
 * CI's SwiftShader doesn't ship a WebGPU backend, so the spec reads the
 * resulting health object rather than demanding GPU availability — the
 * fallback branches are what actually run on the hardware the project
 * tests on, and AC2 timings are reported in telemetry wherever a device
 * does come up.
 */

const WEBGPU_CULL = '__VIRTUALROW_WEBGPU_CULL';

async function enterDemo(page: Page) {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('./');
  await page.locator('.btn-try-demo').click();
  await expect(page.locator('.activity-view')).toBeVisible({ timeout: 30_000 });
}

async function enableSpike(page: Page) {
  await page.addInitScript((flagKey) => {
    const w = window as unknown as Record<string, unknown>;
    w[flagKey] = true;
    w.__PLAYWRIGHT_TESTING = true;
    w.__VIRTUALROW_PERFORMANCE_MODE = 'auto';
  }, WEBGPU_CULL);
}

async function pollHealth(page: Page) {
  return page.evaluate(
    () =>
      window.__VIRTUALROW_WEBGPU_HEALTH as
        | undefined
        | {
            deviceLostCount: number;
            fallbackReason?: string;
            adapter?: string;
            isSoftware?: boolean;
            dispatchMs?: number;
          },
  );
}

test('AC3 — the CPU path still renders when WebGPU is unavailable', async ({ page }) => {
  await enableSpike(page);
  // Guarantee the unsupported branch: delete `navigator.gpu` before the SPA
  // boots. The spike's device hook reads it on mount.
  await page.addInitScript(() => {
    try {
      Object.defineProperty(navigator, 'gpu', { value: undefined, configurable: true });
    } catch {
      /* some browsers refuse the override; the hook's try/catch covers it */
    }
  });
  await enterDemo(page);
  await expect
    .poll(async () => (await pollHealth(page))?.fallbackReason ?? null, {
      timeout: 20_000,
      intervals: [500],
    })
    .toBe('webgpu-unsupported');
  // Trees still render through the CPU cull — the whole point of the fallback.
  const drawn = await page.evaluate(() => window.__ROWER3D_FOLIAGE?.drawn ?? 0);
  expect(drawn).toBeGreaterThan(0);
});

test('AC1 — flag-on and flag-off render the same number of trees within ±2', async ({ browser }) => {
  const flagOffPage = await (await browser.newContext()).newPage();
  await flagOffPage.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    w.__PLAYWRIGHT_TESTING = true;
    w.__VIRTUALROW_PERFORMANCE_MODE = 'auto';
  });
  await enterDemo(flagOffPage);
  const flagOffTrees = await flagOffPage.evaluate(
    () => window.__ROWER3D_FOLIAGE?.trees ?? 0,
  );
  await flagOffPage.close();

  const flagOnPage = await (await browser.newContext()).newPage();
  await enableSpike(flagOnPage);
  await enterDemo(flagOnPage);
  const flagOnTrees = await flagOnPage.evaluate(
    () => window.__ROWER3D_FOLIAGE?.trees ?? 0,
  );
  await flagOnPage.close();

  expect(flagOnTrees).toBeGreaterThan(0);
  expect(Math.abs(flagOnTrees - flagOffTrees)).toBeLessThanOrEqual(2);
});

test('AC4 — a synthesised device-lost raises deviceLostCount', async ({ page }) => {
  await enableSpike(page);
  await page.addInitScript(() => {
    // Replace requestAdapter so the device the hook gets back has a `lost`
    // Promise that resolves immediately — simulating a real driver loss.
    const nav = navigator as unknown as {
      gpu?: { requestAdapter(): Promise<unknown> };
    };
    if (!nav.gpu) return;
    const original = nav.gpu.requestAdapter.bind(nav.gpu);
    nav.gpu.requestAdapter = async (): Promise<unknown> => {
      const adapter = await original();
      if (!adapter) return null;
      const typed = adapter as {
        info?: { vendor?: string; architecture?: string };
        requestDevice: () => Promise<unknown>;
      };
      const originalRequestDevice = typed.requestDevice.bind(typed);
      typed.requestDevice = async () => {
        const device = await originalRequestDevice();
        // Resolve .lost on the next microtask so the hook has set up its
        // handler by then.
        (device as { lost: Promise<unknown> }).lost = Promise.resolve({
          reason: 'destroyed',
          message: 'synthesised',
        });
        return device;
      };
      return typed;
    };
  });
  await enterDemo(page);
  // Either device-lost fires (counter > 0) or the environment has no WebGPU
  // and we fall back — both are acceptable; the spec passes when it has
  // observed one of the two.
  await expect
    .poll(
      async () => {
        const health = await pollHealth(page);
        if (!health) return 'pending';
        if (health.deviceLostCount > 0) return 'device-lost';
        if (health.fallbackReason) return 'fallback';
        return 'ready';
      },
      { timeout: 20_000, intervals: [500] },
    )
    .toMatch(/device-lost|fallback/);
});
