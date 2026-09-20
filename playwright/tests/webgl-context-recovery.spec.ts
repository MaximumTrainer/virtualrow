import { test, expect, type Page } from '../fixtures/crash-watch';
import { expectSceneAlive } from '../utils/scene-health';
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
 *
 * What is NOT covered here: that the scene resumes after a restore. Chrome
 * honours restoreContext() only from the instance that called loseContext(),
 * drops the extension afterwards, and the app's own retry schedule races
 * whatever the test does — a spec written against it passed about half the
 * time, which is worse than no spec. The restore path is covered by unit tests
 * over scheduleContextRestore instead, and the real case (a driver recovering
 * and the browser restoring on its own) cannot be simulated faithfully here.
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

  // This file is exempt from the scene-health sweep because the test below
  // destroys the context deliberately. That exemption was taken per file, and
  // this test destroys nothing: drawCalls is a recorded statistic, so frames
  // drawn before a loss satisfy it just as well as a healthy scene does (#283).
  await expectSceneAlive(page, 'the scene that drew a frame');
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
