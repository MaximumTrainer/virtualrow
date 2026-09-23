import { test, expect, type Page } from '../fixtures/crash-watch';
import { expectSceneAlive } from '../utils/scene-health';

/**
 * Start the demo row with a DOM click rather than a synthesised one.
 *
 * `locator.click()` is bound by the config's 10s `actionTimeout`, and on a
 * Windows runner drawing this scene through SwiftShader the renderer's main
 * thread is busy for longer than that at a stretch: the log reads "element is
 * visible, enabled and stable" and then "performing click action" until the
 * timeout, because the input event is queued behind a frame. The button has
 * already been waited for, so what is left is delivering the click, and
 * `evaluate` delivers it against the test timeout instead of the action one.
 *
 * The same workaround, for the same reason, as the End Workout clicks in
 * `responsive.spec.ts` and `crew-model-loading.spec.ts`.
 */
async function startDemoRow(page: Page) {
  const demo = page.locator('.btn-try-demo');
  await expect(demo).toBeVisible({ timeout: 20_000 });
  await page.evaluate(() =>
    (document.querySelector('.btn-try-demo') as HTMLButtonElement | null)?.click(),
  );
}

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
 * It has a file to itself, having been written in `crew-model-loading.spec.ts`
 * and moved once already. Both of those files say in their own headers that a
 * spec reaching the 3D stage is expensive, and both were right: a demo row on
 * SwiftShader costs minutes, and a worker that has already run two of them
 * fails the third on a Windows runner - first here, as a seat that was never
 * reported, and then in `rower-stroke.spec.ts`, as a click on "Try a demo row"
 * that the blocked main thread did not get to inside the ten-second action
 * timeout.
 *
 * Playwright shards whole files, so one heavy test in a file of its own is one
 * the scheduler can put wherever there is room. Three in a file is three on one
 * worker, whatever the shard count.
 */
test('the rower slides up and down the boat (#330)', async ({ page }) => {
  test.slow();

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.addInitScript(() => {
    (window as unknown as { __VIRTUALROW_PERFORMANCE_MODE?: string })
      .__VIRTUALROW_PERFORMANCE_MODE = 'low';
  });
  await page.goto('./');
  await startDemoRow(page);
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
