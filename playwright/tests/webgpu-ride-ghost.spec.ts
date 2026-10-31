import { test, expect } from '../fixtures/crash-watch';
import {
  GPU_RIDE_LAUNCH_OPTIONS,
  installRideHarness,
  selectPaceGhost,
  waitForRideOutcome,
  forceRender,
  readRideTelemetry,
  assertWellFormedDecline,
} from './helpers/engineRide';

test.use({ launchOptions: GPU_RIDE_LAUNCH_OPTIONS });

/**
 * #570 AC2 / #584 AC5 — "racing a ghost". Pick the pace-boat ghost on the Row
 * screen, start a demo row, and prove the ghost is live and advancing alongside
 * the boat on the WebGPU engine. Replaces the ghost scenario inside the legacy
 * `virtualrow.spec.ts`, which read `__ROWER3D_GHOST_METERS` as a bare number;
 * the new engine publishes `{ value, active }`.
 *
 * Fallback (no hardware adapter): assert the well-formed decline, not the
 * ghost, so the spec is honest on SwiftShader CI.
 */
test('the pace ghost is active and advances during a demo row', async ({ page }) => {
  await installRideHarness(page);
  await page.goto('./');
  await page.waitForSelector('.route-info-overlay h2', { timeout: 15_000 });

  // Choose the pace boat before starting; the target-pace field only appears
  // once it's selected.
  await selectPaceGhost(page, '2:00');

  await page.evaluate(() => {
    (document.querySelector('.btn-try-demo') as HTMLButtonElement | null)?.click();
  });
  await page.waitForURL(/\/row(\/)?$/, { timeout: 15_000 });
  await page.waitForSelector('.rower3d-canvas-container canvas', { timeout: 20_000, state: 'attached' });

  const outcome = await waitForRideOutcome(page);
  if (outcome !== 'ready') {
    await assertWellFormedDecline(page);
    return;
  }

  await page.waitForTimeout(600);
  await forceRender(page);

  const first = await readRideTelemetry(page);
  expect(first.ghost?.active, 'a ghost is being raced').toBe(true);
  const startGhost = first.ghost?.value ?? 0;
  expect(startGhost).toBeGreaterThan(0);

  // The ghost keeps moving down the course as the clock runs.
  await expect
    .poll(
      async () => {
        await forceRender(page);
        const t = await readRideTelemetry(page);
        return t.ghost?.value ?? 0;
      },
      { timeout: 10_000, intervals: [300, 500, 800] },
    )
    .toBeGreaterThan(startGhost);

  // The HUD shows the gap to the ghost with a lead state.
  const gap = page.locator('.row-hud-gap');
  if (await gap.count() > 0) {
    await expect(gap.first()).toHaveAttribute('data-lead', /level|ahead|behind/);
  }
});
