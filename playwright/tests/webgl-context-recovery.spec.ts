import { test, expect, type Page } from '../fixtures/crash-watch';
import { expectSceneAlive } from '../utils/scene-health';
import { useSimServer, releaseSimServer, emitPm5 } from '../utils/sim-server';
import {
  loseContext,
  restoreContext,
  bannerText,
  contextState,
  telemetry,
} from '../utils/gl-context';
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
 * The resume path used to be declared untestable here, and it is testable —
 * the two reasons it flaked both have answers (#309):
 *
 *   - Chrome honours restoreContext() only from the instance that called
 *     loseContext(), so the instance is kept on the page between the calls
 *     (playwright/utils/gl-context.ts) rather than fetched twice.
 *   - the app's own retry schedule raced whatever the test did, so the test
 *     waits for it to finish. RESTORE_DELAYS_MS is [300, 1500, 4000] applied
 *     one after another, which puts the last attempt at about 5.8 s.
 *
 * What still cannot be simulated faithfully is the real case: a driver
 * recovering and the browser restoring on its own.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mockBluetoothPath = path.resolve(__dirname, '../mock-bluetooth.js');

let simulatorReady = false;
test.beforeAll(async () => {
  simulatorReady = await useSimServer();
});
test.afterAll(async () => {
  await releaseSimServer();
});

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

/**
 * Probed on the demo row before any of this existed: the context went, the
 * three attempts ran out at ~5.8 s, and the stage still read
 * "…restoring…" sixteen seconds later. Meanwhile `progress` advanced from
 * 0.0024 to 0.0187 and the session stayed live — the row never stopped, and
 * nothing in the suite said so.
 */

/** Past RESTORE_DELAYS_MS summed (~5.8 s), so nothing of ours races the test. */
const AFTER_THE_APP_GIVES_UP_MS = 7_000;

test('a row keeps counting while the graphics context is gone', async ({ page }) => {
  test.slow();
  expect(simulatorReady, 'the PM5 simulator is not reachable').toBe(true);

  await rowTheDemoRoute(page);
  await expect.poll(() => drawCalls(page), { timeout: 60_000, intervals: [1000] }).toBeGreaterThan(0);

  /** Row a few strokes, so there is a ride in progress to interrupt. */
  const row = async (fromSecond: number, toSecond: number) => {
    for (let second = fromSecond; second <= toSecond; second += 1) {
      await emitPm5({
        distance: Math.round(second * 4.17),
        elapsedTime: second,
        pace: 120,
        cadence: 24,
        power: 180,
        heartRate: 140,
      });
      await page.waitForTimeout(500);
    }
  };

  await row(1, 6);

  const before = await page.evaluate(() => ({
    progress: window.__ROWER3D_POS?.progress ?? 0,
    distance: window.__workoutService?.getCurrentSession?.()?.distance ?? 0,
    session: !!window.__workoutService?.getCurrentSession?.(),
  }));
  expect(before.session, 'there was no session to lose').toBe(true);
  expect(before.distance, 'the row had not started, so there was nothing to interrupt')
    .toBeGreaterThan(0);

  expect(await loseContext(page)).toBe(true);
  await page.waitForTimeout(AFTER_THE_APP_GIVES_UP_MS);

  // Keep rowing through it, which is what the rower does — they are looking at
  // a banner, not at a stopped erg.
  await row(7, 14);

  const after = await page.evaluate(() => ({
    progress: window.__ROWER3D_POS?.progress ?? 0,
    distance: window.__workoutService?.getCurrentSession?.()?.distance ?? 0,
    session: !!window.__workoutService?.getCurrentSession?.(),
  }));

  // Rowing is not coupled to rendering, and must not become so.
  expect(after.session, 'the session was dropped when the view went').toBe(true);
  expect(
    after.distance,
    `the session stopped recording when the context went: ` +
      `${before.distance} m -> ${after.distance} m`,
  ).toBeGreaterThan(before.distance);
  expect(
    after.progress,
    `the boat stopped moving when the context went: ${before.progress} -> ${after.progress}`,
  ).toBeGreaterThan(before.progress);
});

test('a context that will not come back stops claiming it is restoring', async ({ page }) => {
  await rowTheDemoRoute(page);
  await expect.poll(() => drawCalls(page), { timeout: 60_000, intervals: [1000] }).toBeGreaterThan(0);

  expect(await loseContext(page)).toBe(true);

  // First it says it is restoring, which is true while it is.
  await expect
    .poll(() => bannerText(page), { timeout: 20_000, intervals: [500] })
    .toContain('restoring');

  // Then it stops, because it has stopped trying.
  await expect
    .poll(() => bannerText(page), { timeout: 20_000, intervals: [500] })
    .toContain('could not get it back');

  const banner = await bannerText(page);
  expect(banner, 'the rower is not told their row is safe').toContain('still being recorded');
  expect(banner, 'still promising a restore that will not be attempted').not.toContain('restoring');

  // And the row really is still being recorded, so the message is true.
  const session = await page.evaluate(() => !!window.__workoutService?.getCurrentSession?.());
  expect(session, 'the message says the row is safe and it is not').toBe(true);
});

test('the loss is recorded with a reason, and attributed to the canvas on screen', async ({ page }) => {
  await rowTheDemoRoute(page);
  await expect.poll(() => drawCalls(page), { timeout: 60_000, intervals: [1000] }).toBeGreaterThan(0);

  expect(await loseContext(page)).toBe(true);
  await page.waitForTimeout(2_000);

  const lost = (await telemetry(page)).filter((e) => e.kind === 'context-lost');
  expect(lost.length, 'the loss went unrecorded').toBeGreaterThan(0);

  const detail = lost[lost.length - 1].detail ?? {};
  // WEBGL_lose_context carries no statusMessage, and the log says so rather
  // than leaving the field out and reading as "not looked at".
  expect(detail.reason).toBe('the driver gave none');
  // The canvas the rower is looking at, not a mount React discarded (#299).
  expect(detail.onScreen, 'the log cannot say which canvas lost it').toBe(true);
});

test('the scene draws again when the context comes back', async ({ page }) => {
  test.slow();
  await rowTheDemoRoute(page);
  await expect.poll(() => drawCalls(page), { timeout: 60_000, intervals: [1000] }).toBeGreaterThan(0);

  expect(await loseContext(page)).toBe(true);
  await expect
    .poll(() => page.evaluate(() => window.__ROWER3D_WEBGL_LOST === true), { timeout: 20_000 })
    .toBe(true);

  // Wait out the app's own schedule first. Racing it is what made an earlier
  // attempt at this spec pass about half the time.
  await page.waitForTimeout(AFTER_THE_APP_GIVES_UP_MS);
  expect(await restoreContext(page), 'the extension instance was not held').toBe(true);

  await expect
    .poll(() => page.evaluate(() => window.__ROWER3D_WEBGL_LOST === false), {
      timeout: 20_000,
      intervals: [500],
    })
    .toBe(true);

  // Polled, not read once.
  //
  // There are two readings of "is the context back", and they do not land
  // together. `__ROWER3D_WEBGL_LOST` is set by the `webglcontextrestored`
  // handler itself, so it flips the instant the event arrives.
  // `__ROWER3D_CONTEXT_STATE` is a copy of the module's state taken inside
  // `useFrame` - so it is stale until the scene draws again, and after a
  // restore on a software rasteriser the first frame is not immediate.
  //
  // Reading it once, straight after polling the other flag, is a race the
  // macOS leg lost about half the time while every other platform won it. That
  // this spec is named for the scene drawing again is the point: waiting for
  // the frame-published reading is waiting for the frame.
  await expect
    .poll(() => page.evaluate(() => window.__ROWER3D_CONTEXT_STATE?.lost), {
      timeout: 20_000,
      intervals: [250],
      message: 'the scene still believes its context is gone',
    })
    .toBe(false);

  const state = await contextState(page);
  // One loss, not two: a restore must not be recorded as another failure.
  expect(state?.losses).toBe(1);

  const restored = (await telemetry(page)).filter((e) => e.kind === 'context-restored');
  expect(restored.length, 'the restore went unrecorded').toBeGreaterThan(0);

  await expect
    .poll(() => bannerText(page), { timeout: 20_000, intervals: [500] })
    .toBe('');
});
