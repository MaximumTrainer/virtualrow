/**
 * #584 AC5.2 — device-lost recovery on the WebGPU engine.
 *
 * Ported from the retired `webgl-context-recovery.spec.ts`. WebGPU has no
 * `WEBGL_lose_context` equivalent and `GPUDevice.destroy()` is only callable
 * from inside the page, so the engine exposes a `__ROWER3D_FORCE_DEVICE_LOST`
 * seam under `__PLAYWRIGHT_TESTING` (#584 FR2 D4-a). Forcing a loss must:
 *   - flip `__ROWER3D_CONTEXT_STATE.kind` and show the ride view's banner
 *     while a reattach on the same canvas is in flight (FR1 D1-a / D2-a), then
 *   - settle back to `ready` with `fallbackReason === 'device-lost'` recorded,
 *   - all while the row keeps counting (DOM-driven, NFR2).
 *
 * The unit half (ac4PortedBehaviors.test.ts "(B) device-lost") asserts the
 * same transitions against the mock device; this is the real-`/row` e2e half.
 * Only meaningful on a real adapter; on a runner without one the engine never
 * had a device to lose, so the spec asserts the well-formed decline instead.
 */
import { expect, test } from '../fixtures/crash-watch';
import {
  GPU_RIDE_LAUNCH_OPTIONS,
  assertWellFormedDecline,
  forceDeviceLost,
  installRideHarness,
  readBanner,
  readHealth,
  startDemoRide,
  waitForRideOutcome,
} from './helpers/engineRide';

test.use({ launchOptions: GPU_RIDE_LAUNCH_OPTIONS });

test('forcing a device loss shows the banner, then recovers on the same canvas (#584 AC5.2)', async ({
  page,
}) => {
  await installRideHarness(page);
  await startDemoRide(page);

  if ((await waitForRideOutcome(page)) === 'fallback') {
    // No hardware adapter → no live device to lose. The seam is absent; the
    // engine already surfaced why it declined.
    await assertWellFormedDecline(page);
    return;
  }

  // Sanity: the ride is on the engine and recovery health is clean.
  expect((await readHealth(page))?.fallbackReason).toBeFalsy();

  await forceDeviceLost(page);

  // The loss is observable before recovery completes: either the banner is up
  // or the context has flipped out of 'ready'. On a real adapter the retry
  // rebuilds the whole scene (awaits the boat mesh + scenery GLBs), so this
  // transient is a real, catchable window — unlike the instant mock retry.
  await expect
    .poll(
      async () => {
        const banner = await readBanner(page);
        const kind = await page.evaluate(
          () =>
            (window as unknown as { __ROWER3D_CONTEXT_STATE?: { kind: string } })
              .__ROWER3D_CONTEXT_STATE?.kind,
        );
        return !!banner?.visible || kind !== 'ready';
      },
      { timeout: 5_000, intervals: [50, 100, 150, 250, 500] },
    )
    .toBe(true);

  // Recovery: the engine reattaches on the same canvas and settles back to
  // ready, the banner clears, and the loss is recorded in health.
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            (window as unknown as { __ROWER3D_CONTEXT_STATE?: { kind: string; backend: string } })
              .__ROWER3D_CONTEXT_STATE?.kind,
        ),
      { timeout: 30_000, intervals: [200, 500, 1000] },
    )
    .toBe('ready');

  const health = await readHealth(page);
  expect(health?.fallbackReason, 'the loss is recorded as device-lost').toBe('device-lost');
  expect(health?.deviceLostCount ?? 0).toBeGreaterThanOrEqual(1);

  const banner = await readBanner(page);
  expect(banner?.visible, 'the banner clears after recovery').toBe(false);

  // NFR2 — the row is DOM-driven, so it kept counting through the loss: the
  // workout session is still live on the page.
  const rowAlive = await page.evaluate(
    () => !!(window as unknown as { __workoutService?: unknown }).__workoutService,
  );
  expect(rowAlive, 'the row session survives a render loss').toBe(true);
});
