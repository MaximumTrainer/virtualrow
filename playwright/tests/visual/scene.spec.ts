import { test, expect, type Page } from '../../fixtures/crash-watch';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { expectSceneAlive } from '../../utils/scene-health';

/**
 * Issue #340 — the visual baselines.
 *
 * Every ticket in the visual backlog moves pixels, and until this existed there
 * was one committed baseline in the whole suite. `scene-contrast.spec.ts` can
 * tell you the water is not the same colour as the bank; it cannot tell you the
 * fog got twice as thick, the horizon dropped, or the boat is now ten times too
 * small. This photographs the scene and compares it with what it looked like
 * before the change.
 *
 * Three things make the picture repeatable:
 *
 *  - `__ROWER3D_FREEZE` stops the clock, pins the boat to a point on the route
 *    and parks the oars, so the frame does not depend on how long the page took
 *    to load (see `src/components/rower3d/sceneFreeze.ts`).
 *  - `__ROWER3D_FORCE_RENDER` draws the frame synchronously before the capture.
 *    The renderer clears to a transparent buffer, and on a software rasteriser
 *    a screenshot otherwise lands in the gap between two frames (#261).
 *  - The same route geometry every time. All six themes row the same imported
 *    course, so a difference between two shots is the theme and nothing else.
 *
 * The capture is of the canvas, with the two HUD panels that sit over it — the
 * route summary and the minimap — masked out. They are DOM, not scene: their
 * text is the route name, which differs per theme by construction, and nothing
 * either of them shows is a fact about how the world is drawn.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mockBluetoothPath = path.resolve(__dirname, '../../mock-bluetooth.js');
const courseFixturePath = path.resolve(__dirname, '../../fixtures/rownative-sample-course.geojson');

/**
 * The one surviving theme (#361).
 *
 * This was six route names, because the theme used to be read off the name.
 * Five of them were retired - fantasy reskins that between them intercepted
 * the Tideway, the Charles and Henley Reach - so there is one look to
 * photograph and the suite is four shots rather than twenty-four.
 */
const THEMES = [{ theme: 'willowbrook', routeName: 'Willowbrook Reach' }] as const;

/**
 * Both tiers a rower can actually get.
 *
 * `low` is the geometry alone; `auto` adds the post-processing stack over it.
 * They are different pictures, and a grade that washes the scene out is
 * invisible to a baseline that only ever looked at `low` — the same blind spot
 * `scene-contrast.spec.ts` was written to close (#291).
 */
const TIERS = ['low', 'auto'] as const;

/** Desktop and phone. The scene is framed differently at each. */
const VIEWPORTS = [
  { width: 1280, height: 720 },
  { width: 390, height: 844 },
] as const;

/**
 * The HUD panels drawn over the canvas.
 *
 * Masked rather than cropped around: they are absolutely positioned on top of
 * the scene, so an element screenshot of the canvas includes whatever is
 * painted over it.
 */
/**
 * The DOM that sits over the stage, kept out of the shot.
 *
 * The HUD's two visible pieces joined them with #335, which moved the metric
 * strip onto the stage. Same argument as the other two: the numbers on the
 * strip are a live split and a live stroke count, so a baseline that
 * photographed them would fail on its second run for reasons that have nothing
 * to do with how the world is drawn.
 *
 * `.row-hud-strip` and `.row-hud-actions`, and deliberately not `.row-hud`
 * itself - that is a full-stage layer with `pointer-events: none` and nothing
 * drawn on it, so masking it would put a magenta rectangle over every pixel of
 * the scene and leave a suite of four identical blank shots.
 */
const HUD_SELECTORS = [
  '.activity-route-summary',
  '.activity-map-overlay',
  '.row-hud-strip',
  '.row-hud-actions',
] as const;

/** Where on the route, and at what second, every shot is taken. */
const FREEZE = { time: 12.5, progress: 0.31 };

/**
 * How long the scene is given to finish loading before the shutter opens.
 *
 * The freeze stops the animation but not the downloads: scenery GLBs, textures
 * and the effect stack all arrive after the first frame, and a shot taken
 * before them is a picture of a half-built world. Eight seconds is what the
 * heavier 3D specs already allow for the same settling on SwiftShader.
 */
const SETTLE_MS = 8_000;

/**
 * How long the capture itself may take.
 *
 * Playwright establishes that a screenshot is stable by taking it twice, 100ms
 * apart, and requiring the pair to match. On SwiftShader each of those is a
 * framebuffer readback and a PNG encode, so the 5s default runs out mid-capture
 * and reports a stable canvas as an unstable element.
 */
const CAPTURE_TIMEOUT_MS = 30_000;

async function waitForDeviceConnected(page: Page, label: string) {
  await page.waitForFunction(
    (l) => {
      const containers = Array.from(document.querySelectorAll('.bluetooth-device-container'));
      const target = containers.find((c) =>
        c.querySelector('.device-name')?.textContent?.includes(l),
      );
      return target?.querySelector('.device-status')?.textContent?.includes('Connected') ?? false;
    },
    label,
    { timeout: 15_000 },
  );
}

/** Import the shared course under `routeName`, connect the devices, and row. */
async function rowFrozen(
  page: Page,
  { routeName, tier }: { routeName: string; tier: (typeof TIERS)[number] },
) {
  await page.addInitScript(
    ({ mode, freeze }) => {
      window.__VIRTUALROW_PERFORMANCE_MODE = mode;
      window.__ROWER3D_FREEZE = freeze;
    },
    { mode: tier, freeze: FREEZE },
  );
  await page.addInitScript({ content: fs.readFileSync(mockBluetoothPath, 'utf8') });

  await page.goto('./');

  // Below 768px the nav lives behind the hamburger, and the phone viewport in
  // the matrix is one of those.
  const navToggle = page.locator('.nav-toggle');
  if (await navToggle.isVisible()) await navToggle.click();

  await page.getByRole('button', { name: 'Routes', exact: true }).click();
  await expect(page.locator('.view-container--search')).toBeVisible();
  await page.getByRole('button', { name: /import a file/i }).click();
  await page.getByLabel('Route name').fill(routeName);
  await page.locator('.route-import input[type="file"]').setInputFiles(courseFixturePath);
  await expect(page.locator('.route-info-overlay h2')).toContainText(routeName, {
    timeout: 15_000,
  });

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

  await page.evaluate(() =>
    (document.querySelector('.btn-start-workout') as HTMLButtonElement)?.click(),
  );

  const canvas = page.locator('.rower3d-canvas-container canvas').first();
  await expect(canvas).toBeVisible({ timeout: 30_000 });
  await expectSceneAlive(page, 'the visual baseline scene');
  await page.waitForFunction(() => window.__ROWER3D_ROUTE?.hasCurve === true, undefined, {
    timeout: 30_000,
  });
  await page.waitForTimeout(SETTLE_MS);

  return canvas;
}

for (const { theme, routeName } of THEMES) {
  for (const tier of TIERS) {
    for (const { width, height } of VIEWPORTS) {
      test(`${theme} at ${tier} renders the same scene at ${width}x${height}`, async ({ page }) => {
        test.slow();

        await page.setViewportSize({ width, height });
        const canvas = await rowFrozen(page, { routeName, tier });

        // The boat has to be where the freeze put it, or the shot is of a scene
        // that was never held still and the baseline means nothing.
        const progress = await page.evaluate(() => window.__ROWER3D_POS?.progress ?? -1);
        expect(progress, 'the scene did not honour __ROWER3D_FREEZE').toBeCloseTo(
          FREEZE.progress,
          3,
        );

        await page.evaluate(() => window.__ROWER3D_FORCE_RENDER?.());

        // A perceptual comparison, not an exact one. SwiftShader is
        // deterministic frame to frame but not bit-identical across Chromium
        // builds, and a baseline that fails on a browser bump is a baseline
        // nobody keeps.
        await expect(canvas).toHaveScreenshot(`${theme}-${tier}-${width}x${height}.png`, {
          maxDiffPixelRatio: 0.01,
          threshold: 0.3,
          animations: 'disabled',
          mask: HUD_SELECTORS.map((selector) => page.locator(selector)),
          // Playwright proves a shot is stable by taking it twice and requiring
          // the two to match, and a readback plus a PNG encode of a
          // software-rasterised canvas takes seconds rather than milliseconds.
          // The 5s default expires in the middle of the second capture, which
          // reads as an unstable element and is really a stopwatch.
          timeout: CAPTURE_TIMEOUT_MS,
        });
      });
    }
  }
}
