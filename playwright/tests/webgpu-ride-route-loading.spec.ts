import { test, expect } from '../fixtures/crash-watch';
import {
  GPU_RIDE_LAUNCH_OPTIONS,
  installRideHarness,
  startDemoRide,
  waitForRideOutcome,
  forceRender,
  readRideTelemetry,
  assertWellFormedDecline,
} from './helpers/engineRide';

test.use({ launchOptions: GPU_RIDE_LAUNCH_OPTIONS });

/**
 * #570 AC2 / #584 AC5 — route loading. Starting a demo row builds the route's
 * world curve and the engine draws it. Prove the engine resolved a real route
 * (a curve with a positive length and total distance) and is submitting draws,
 * on the new WebGPU engine. Replaces the legacy `route-loading-progress.spec.ts`.
 *
 * Fallback (no hardware adapter): assert the well-formed decline.
 */
test('the demo route resolves a world curve and the engine draws it', async ({ page }) => {
  await installRideHarness(page);
  await startDemoRide(page);

  const outcome = await waitForRideOutcome(page);
  if (outcome !== 'ready') {
    await assertWellFormedDecline(page);
    return;
  }

  // Give the route build + first frames a moment, then draw one.
  await page.waitForTimeout(600);
  await forceRender(page);

  // The route seam reports a resolved world curve.
  await expect
    .poll(
      async () => {
        await forceRender(page);
        const t = await readRideTelemetry(page);
        return t.route?.hasCurve === true && (t.route?.totalDistance ?? 0) > 0;
      },
      { timeout: 10_000, intervals: [300, 500, 800] },
    )
    .toBe(true);

  const t = await readRideTelemetry(page);
  expect(t.route?.curveLength ?? 0, 'the route curve has length').toBeGreaterThan(0);
  expect(t.route?.totalDistance ?? 0).toBeGreaterThan(0);

  // Frames are being produced (the counter advances across forced renders).
  const framesBefore = t.frame?.frame ?? 0;
  await forceRender(page);
  const after = await readRideTelemetry(page);
  expect(after.frame?.frame ?? 0).toBeGreaterThan(framesBefore);
});
