import { test, expect } from '../fixtures/crash-watch';
import { expectSceneAlive } from '../utils/scene-health';
import {
  CATCH_SWEEP_RAD,
  FINISH_SWEEP_RAD,
} from '../../src/components/rower3d/strokePose';

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

/**
 * How far the oar can sweep either way, from the angles the stroke is built
 * from rather than from a number written down beside them.
 *
 * This was a flat 0.5, with a comment saying `oarSweep` is
 * `sin(phase * 2pi) * 0.5`. It was, until #329 gave the stroke the catch and
 * finish angles a sculler actually rows - 55 degrees towards the bow and 35
 * the other way - and then the spec was asserting the shape of a stroke the
 * code had stopped having. Importing the constants means the next person to
 * retune them does not have to remember this line exists.
 */
const OAR_LIMIT = Math.max(Math.abs(CATCH_SWEEP_RAD), Math.abs(FINISH_SWEEP_RAD));

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

/**
 * Issue #328 — the camera is a rig, and the rower can point it somewhere else.
 *
 * It was `camera.position.set(boat - tangent * 6)` every frame, with no lag,
 * no damping and one view. What is checked here is the part a unit test
 * cannot reach: that the rig is actually driving the camera in a running
 * scene, that it settles where it says it will, and that `V` reaches it.
 */
test('the camera rig follows the boat and answers to V', async ({ page }) => {
  test.slow();

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.addInitScript(() => {
    (window as unknown as { __VIRTUALROW_PERFORMANCE_MODE?: string })
      .__VIRTUALROW_PERFORMANCE_MODE = 'low';
    // `__ROWER3D_POS` is automation scaffolding and stays behind the test
    // flag; the camera is measured against it, so this spec sets it.
    window.__PLAYWRIGHT_TESTING = true;
  });
  await page.goto('./');
  await page.locator('.btn-try-demo').click();
  await page.locator('.rower3d-canvas-container').waitFor({ state: 'visible', timeout: 30_000 });
  await expectSceneAlive(page, 'the camera scene');

  await expect
    .poll(() => page.evaluate(() => window.__ROWER3D_CAMERA?.view ?? null), {
      timeout: 30_000,
      message: 'the camera never reported which view it was using',
    })
    .toBe('chase');

  // Long enough for the damping to have settled: the position time constant is
  // 0.35 s, so three seconds is eight of them.
  await page.waitForTimeout(3_000);

  const settled = await page.evaluate(() => {
    const camera = window.__ROWER3D_CAMERA;
    const boat = window.__ROWER3D_POS;
    if (!camera || !boat) return null;
    return {
      view: camera.view,
      fov: camera.fov,
      distance: Math.hypot(camera.position[0] - boat.x, camera.position[2] - boat.z),
      height: camera.position[1] - boat.y,
    };
  });

  expect(settled, 'no camera or boat position was published').not.toBeNull();
  console.log(
    `[camera] view=${settled!.view} distance=${settled!.distance.toFixed(2)}m ` +
      `height=${settled!.height.toFixed(2)}m fov=${settled!.fov?.toFixed(1)}`,
  );

  // The chase view sits 7 m back. The window is wide enough for a boat that is
  // still accelerating, and narrow enough to fail if the rig stopped driving.
  expect(settled!.distance).toBeGreaterThan(6.5);
  expect(settled!.distance).toBeLessThan(7.5);
  expect(settled!.height).toBeGreaterThan(2.3);
  expect(settled!.height).toBeLessThan(2.9);

  // Pressing V reaches the rig, and the button says the same thing.
  await page.locator('.rower3d-canvas-container canvas').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('v');

  await expect
    .poll(() => page.evaluate(() => window.__ROWER3D_CAMERA?.view ?? null), {
      timeout: 15_000,
      message: 'V did not change the camera view',
    })
    .toBe('side');

  await expect(page.locator('.btn-camera-view')).toContainText('side');
});

/**
 * Issue #330 — the rower slides.
 *
 * The rig has authored a `Seat` node alongside the oars since it was built and
 * nothing ever moved it: the legs compressed while the seat stayed where it
 * was, so the rower shrank and grew rather than sliding up and down the boat.
 *
 * Sampled from the running scene rather than from the pose, because the pose
 * is unit-tested already — what this adds is that the GLB's seat is being
 * driven by it.
 *
 * It lives here rather than beside the crew models, where it was written. Two
 * reasons, both learned from CI. It is a stroke spec, not a loading one. And
 * `crew-model-loading.spec.ts` says in its own header that it must stay cheap:
 * a third demo row in that file put three 3D scenes in one worker, and on the
 * busiest Windows shard the seat was never reported at all.
 */
test('the rower slides up and down the boat (#330)', async ({ page }) => {
  test.slow();

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.addInitScript(() => {
    (window as unknown as { __VIRTUALROW_PERFORMANCE_MODE?: string })
      .__VIRTUALROW_PERFORMANCE_MODE = 'low';
  });
  await page.goto('./');
  await page.locator('.btn-try-demo').click();
  await page.locator('.rower3d-canvas-container').waitFor({ state: 'visible', timeout: 30_000 });
  // Not decoration, and the reason this spec failed on Windows while the blade
  // spec it was copied from passed: a visible container is only a <div>, and
  // three.js builds its renderer behind a ResizeObserver and an await. This
  // waits for that, so the telemetry poll below starts counting once there is
  // something that could publish, and a scene that never comes up says so
  // instead of timing out on a null.
  await expectSceneAlive(page, 'the slide scene');

  await expect
    .poll(() => page.evaluate(() => window.__ROWER3D_SEAT_Z ?? null), {
      // A minute, where the first frame on a saturated SwiftShader runner
      // has to follow a 2 MB GLB over the wire and through a parse. Measured
      // on windows-latest shard 1 of run 35788412008, where a frame cost
      // 290 ms and 30 s was not enough.
      timeout: 60_000,
      message: 'the scene never reported where its seat was',
    })
    .not.toBeNull();

  const seen: number[] = [];
  for (let i = 0; i < 60; i += 1) {
    const z = await page.evaluate(() => window.__ROWER3D_SEAT_Z ?? null);
    if (z !== null) seen.push(z);
    await page.waitForTimeout(120);
  }

  expect(seen.length, 'no seat positions were sampled').toBeGreaterThan(30);
  const travel = Math.max(...seen) - Math.min(...seen);
  console.log(`[slide] travel ${travel.toFixed(3)} m over ${seen.length} samples`);

  expect(travel, 'the rower is not sliding').toBeGreaterThanOrEqual(0.4);
});
