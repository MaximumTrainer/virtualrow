import { test, expect } from '@playwright/test';
import { expectSceneAlive } from '../utils/scene-health';

/**
 * Issue #273 — the rower's arms move with the oars in the GLB scull.
 *
 * The GLB scull renders only when `IS_TEST_MODE` is false, so this spec
 * deliberately installs no BLE harness: with it, the app renders the
 * *procedural* scull instead and the path a real session uses goes untested.
 * That asymmetry is how the rower came to sit rigid while the oars swept, with
 * every spec passing.
 *
 * What this can and cannot assert. Both angles come from one `strokePose`, so
 * if the arm reports a value in the band that pose produces, the arms are being
 * driven by the stroke rather than left at rest. What it cannot show is the
 * arms *moving*: the render loop draws once and then idles (#261), so the
 * stroke phase does not advance and every sample reads the same pose. Movement
 * is covered by strokePose.test.ts until that is fixed.
 */

/** The range strokePose can produce: -0.5 + armPull * 1.2, armPull in 0..1. */
const ARM_MIN = -0.5;
const ARM_MAX = 0.7;

/** oarSweep is sin(phase * 2pi) * 0.5. */
const OAR_LIMIT = 0.5;

test('the GLB scull drives the rower from the same stroke as the oars', async ({ page }) => {
  test.slow();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.addInitScript(() => {
    (window as unknown as { __VIRTUALROW_PERFORMANCE_MODE?: string })
      .__VIRTUALROW_PERFORMANCE_MODE = 'low';
  });
  await page.goto('./');
  await page.locator('.btn-try-demo').click();
  await page.locator('.rower3d-canvas-container').waitFor({ state: 'visible', timeout: 30_000 });
  await expectSceneAlive(page, 'the stroke scene');

  await expect
    .poll(() => page.evaluate(() => window.__ROWER3D_ARM_ANGLE ?? null), {
      timeout: 30_000,
      message: 'the GLB scull never reported an arm angle — the rower is not being animated',
    })
    .not.toBeNull();

  const { arm, oar } = await page.evaluate(() => ({
    arm: window.__ROWER3D_ARM_ANGLE ?? null,
    oar: window.__ROWER3D_OAR_ANGLE ?? null,
  }));

  expect(Number.isFinite(arm), 'the arm angle is not a number').toBe(true);
  expect(Number.isFinite(oar), 'the oar angle is not a number').toBe(true);

  // In the band the shared stroke produces — so the arms are posed by the
  // stroke, not parked at whatever the model was authored with.
  expect(arm!).toBeGreaterThanOrEqual(ARM_MIN - 0.001);
  expect(arm!).toBeLessThanOrEqual(ARM_MAX + 0.001);
  expect(Math.abs(oar!)).toBeLessThanOrEqual(OAR_LIMIT + 0.001);

  expect(errors.filter((e) => !/reading 'alpha'/.test(e))).toEqual([]);
});
