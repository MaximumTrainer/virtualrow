import { test, expect } from '../fixtures/crash-watch';
import { assertCanvasNotBlank } from './helpers/assertCanvasNotBlank';
import {
  GPU_RIDE_LAUNCH_OPTIONS,
  installRideHarness,
  startDemoRide,
  waitForRideOutcome,
  forceRender,
  readRideTelemetry,
  assertWellFormedDecline,
} from './helpers/engineRide';

// Real WebGPU, not forced SwiftShader — on the GPU runner this reaches the
// hardware adapter and the ride renders for real (#570 AC2 / #584 AC5).
test.use({ launchOptions: GPU_RIDE_LAUNCH_OPTIONS });

/**
 * #570 AC2 / #584 AC5 — the integrated "boot and row" verification on the new
 * WebGPU engine: start a demo row through the real Svelte `/row` flow and prove
 * the boat actually moves. This is the engine-track replacement for the legacy
 * three.js `virtualrow.spec.ts` (still in `playwright.config.next.ts`'s ignore
 * list until the React tree is deleted).
 *
 * On a runner without a hardware WebGPU adapter the engine declines and the
 * spec asserts the well-formed fallback instead of the motion, so it is green
 * on SwiftShader CI and meaningful on the GPU runner (no silent pass, #542
 * NFR5).
 */
test('a demo row advances the boat on the WebGPU engine', async ({ page }) => {
  await installRideHarness(page);
  await startDemoRide(page);

  const outcome = await waitForRideOutcome(page);
  if (outcome !== 'ready') {
    await assertWellFormedDecline(page);
    return;
  }

  const canvas = page.locator('.rower3d-canvas-container canvas').first();
  await expect(canvas).toHaveAttribute('data-backend', 'webgpu');

  // Let the demo simulators stream a little, then draw a frame so the boat
  // telemetry picks up the advance (test mode doesn't free-run the loop).
  await page.waitForTimeout(600);
  await forceRender(page);

  const first = await readRideTelemetry(page);
  expect(first.boat?.isPlaying, 'the boat is rowing').toBe(true);
  expect(first.crew?.cadenceSpm ?? 0, 'the crew is stroking').toBeGreaterThan(0);
  expect(first.crew?.rowers ?? 0).toBeGreaterThan(0);
  expect(typeof first.pos?.progress).toBe('number');

  const startDistance = first.boat?.distanceMeters ?? 0;

  // Distance keeps growing as the row continues.
  await expect
    .poll(
      async () => {
        await forceRender(page);
        const t = await readRideTelemetry(page);
        return t.boat?.distanceMeters ?? 0;
      },
      { timeout: 10_000, intervals: [300, 500, 800] },
    )
    .toBeGreaterThan(startDistance);

  const moving = await readRideTelemetry(page);
  expect(moving.speedMps ?? 0, 'boat speed is positive while rowing').toBeGreaterThan(0);
  expect(moving.pos?.progress ?? 0).toBeGreaterThanOrEqual(first.pos?.progress ?? 0);

  // Guards the #549 black-canvas regression: every seam above can read
  // correctly while the submitted command buffers render nothing.
  await assertCanvasNotBlank(page, canvas);
});
