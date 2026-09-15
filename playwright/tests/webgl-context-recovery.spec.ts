import { test, expect, type Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

/**
 * The scene has to survive losing its graphics context.
 *
 * A rower reported a blank 3D view with the workout still counting: the canvas
 * was transparent, the container's background showed through, and nothing said
 * why. The context-lost handler revealed an empty div and never asked for the
 * context back, so a single loss ended the session's rendering silently.
 *
 * WEBGL_lose_context reproduces that on any machine, which is what makes this
 * checkable rather than a hardware story.
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

async function rowTheDemoRoute(page: Page) {
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
}

/** Draw calls only advance while the scene is actually rendering. */
const drawCalls = (page: Page) =>
  page.evaluate(() => window.__ROWER3D_RENDER_STATS?.drawCalls ?? 0);

/** When the scene last measured a frame — a moving timestamp means it is drawing. */
const sampledAt = (page: Page) =>
  page.evaluate(() => window.__ROWER3D_RENDER_STATS?.sampledAt ?? 0);

const loseContext = (page: Page) =>
  page.evaluate(() => {
    const canvas = document.querySelector('.rower3d-canvas-container canvas') as HTMLCanvasElement;
    const gl = canvas?.getContext('webgl2') as WebGL2RenderingContext | null;
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
    return !!gl;
  });

test('the scene draws a frame at all', async ({ page }) => {
  await rowTheDemoRoute(page);

  // The regression this guards: a canvas that mounts, never renders, and says
  // nothing about it.
  await expect.poll(() => drawCalls(page), { timeout: 60_000, intervals: [1000] }).toBeGreaterThan(0);
});

test('a lost context is explained and asked back', async ({ page }) => {
  await rowTheDemoRoute(page);
  await expect.poll(() => drawCalls(page), { timeout: 60_000, intervals: [1000] }).toBeGreaterThan(0);

  expect(await loseContext(page)).toBe(true);

  // The rower is told, rather than left with an empty box.
  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          const marker = document.querySelector('.rower3d-fallback-marker') as HTMLElement | null;
          return marker && marker.style.display !== 'none' ? (marker.textContent ?? '') : '';
        }),
      { timeout: 20_000, intervals: [500] },
    )
    .toContain('lost the graphics context');

  await expect
    .poll(() => page.evaluate(() => window.__ROWER3D_WEBGL_LOST === true), { timeout: 20_000 })
    .toBe(true);
});

test('the scene comes back when the context is restored', async ({ page }) => {
  await rowTheDemoRoute(page);
  await expect.poll(() => drawCalls(page), { timeout: 60_000, intervals: [1000] }).toBeGreaterThan(0);

  const before = await sampledAt(page);

  // Keep the extension instance that lost the context: Chrome honours
  // restoreContext() only from the instance that called loseContext(), and
  // drops the extension afterwards. A real driver loss is restored by the
  // browser itself — this stands in for that, and exercises the half the app
  // owns: noticing, clearing the message, and drawing again.
  await page.evaluate(() => {
    const canvas = document.querySelector('.rower3d-canvas-container canvas') as HTMLCanvasElement;
    const gl = canvas?.getContext('webgl2') as WebGL2RenderingContext | null;
    const ext = gl?.getExtension('WEBGL_lose_context');
    (window as unknown as { __TEST_LOSE_EXT?: unknown }).__TEST_LOSE_EXT = ext;
    ext?.loseContext();
  });

  await expect
    .poll(() => page.evaluate(() => window.__ROWER3D_WEBGL_LOST === true), { timeout: 20_000 })
    .toBe(true);

  // Let the app's own nudges run out first (RESTORE_DELAYS_MS totals ~5.8 s).
  // This is the real shape of a driver loss the app cannot talk its way out of:
  // it asks, the asks fail, and the browser restores when the GPU is ready.
  await page.waitForTimeout(7000);

  await page.evaluate(() => {
    (
      window as unknown as { __TEST_LOSE_EXT?: { restoreContext?: () => void } }
    ).__TEST_LOSE_EXT?.restoreContext?.();
  });

  // Both together: a flag that flips while the message stays up would still
  // leave the rower looking at a box that says the view is broken.
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const el = document.querySelector('.rower3d-fallback-marker') as HTMLElement | null;
          return {
            lost: window.__ROWER3D_WEBGL_LOST === true,
            message: el?.style.display !== 'none',
          };
        }),
      { timeout: 30_000, intervals: [500] },
    )
    .toEqual({ lost: false, message: false });

  // ...and the loop is drawing again. Draw calls are steady frame to frame, so
  // the timestamp is what proves liveness, not the count.
  await expect
    .poll(() => sampledAt(page), { timeout: 30_000, intervals: [1000] })
    .toBeGreaterThan(before);
});
