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
 * #570 AC2 / #584 AC5 — world scale. The engine renders one scene unit per
 * metre (`SCENE_SCALE = 1`, src/lib/utils/worldScale.ts), so the boat's world
 * displacement over an interval must match the metres it rowed over the same
 * interval. Replaces the legacy three.js `world-scale.spec.ts`, which timed its
 * two position reads by `__ROWER3D_POS.at` — a field the new engine does not
 * publish — so this times the interval by the spec's own clock and reads the
 * `{ x, y, z }` the engine does publish.
 *
 * Fallback (no hardware adapter): assert the well-formed decline.
 */
test('world displacement matches metres rowed (scene scale = 1)', async ({ page }) => {
  await installRideHarness(page);
  await startDemoRide(page);

  const outcome = await waitForRideOutcome(page);
  if (outcome !== 'ready') {
    await assertWellFormedDecline(page);
    return;
  }

  // First reading once the boat is actually moving.
  await page.waitForTimeout(800);
  await forceRender(page);
  const a = await readRideTelemetry(page);
  expect(a.boat?.isPlaying).toBe(true);
  expect(a.pos, 'engine publishes a boat position').toBeTruthy();

  // Second reading after a measured interval.
  await page.waitForTimeout(2500);
  await forceRender(page);
  const b = await readRideTelemetry(page);

  const distanceRowed = (b.boat?.distanceMeters ?? 0) - (a.boat?.distanceMeters ?? 0);
  expect(distanceRowed, 'the boat rowed some metres in the interval').toBeGreaterThan(1);

  const dx = (b.pos?.x ?? 0) - (a.pos?.x ?? 0);
  const dz = (b.pos?.z ?? 0) - (a.pos?.z ?? 0);
  const worldDisplacement = Math.hypot(dx, dz);

  // Over a short interval the route is near-straight, so the world chord is
  // close to the arc length. Scene scale is 1, so the two are the same metre.
  // Generous tolerance (mirrors the legacy 0.45) absorbs route curvature and
  // frame-timing jitter; a broken scale (e.g. the old three-scales bug) would
  // miss by a factor, not a fraction.
  const ratio = worldDisplacement / distanceRowed;
  expect(ratio, `world ${worldDisplacement.toFixed(1)}u vs rowed ${distanceRowed.toFixed(1)}m`).toBeGreaterThan(0.55);
  expect(ratio).toBeLessThan(1.45);
});
