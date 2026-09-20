import { test, expect, type Page } from '@playwright/test';
import { expectSceneAlive } from '../utils/scene-health';

/**
 * The boat and its oars have to fit in the river.
 *
 * A rower reported the blades sitting level with or beyond the bank. The boat
 * is placed on the route curve and the channel is built symmetrically about
 * that same curve, so it is purely a question of width: half the channel
 * against the 2.78 m the blades reach either side (#271).
 *
 * `navigableWidth.ts` floors the channel so that can never be negative, and
 * unit tests prove the floor. What no test covered is whether the running scene
 * applies it — the water, both banks and the debug guides each read the width
 * separately, and #271's last acceptance point is about where the boat sits
 * between the red edges rather than about what a function returns.
 *
 * So this watches the game a human plays: open the demo row, let the boat move,
 * and read the clearance the scene itself publishes, from the same width
 * function the water is built from.
 *
 * What it does and does not prove. Measured on the demo route, the narrowest
 * clearance over 25 s is 19.72 m against a 22.50 m half-width — the demo river
 * is wide and never goes near the limit, so this is not the narrow case. The
 * narrow case is `navigableWidth.test.ts` and `oarsStayOnWater.test.ts`, which
 * drive the floor with 3 m and 4 m channels directly. What this adds is the
 * half neither can reach: that the scene reads its width from the floored
 * function at all, rather than from some other number that happens to be wide
 * enough today. A route traverse in route-endurance.spec.ts carries the same
 * reading across every segment of a whole route.
 */

/** Enough of a row to cross several segments, and the bends between them. */
const WATCH_MS = 25_000;

const readClearance = (page: Page) =>
  page.evaluate(() => window.__ROWER3D_CLEARANCE ?? null);

test('the blades stay over water for the whole demo row', async ({ page }) => {
  test.slow();

  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  // The visitor's own path — no BLE harness, no pinned tier, no imported
  // course — with one flag turned on.
  //
  // The clearance reading is published under IS_TEST_MODE, which mock-bluetooth
  // sets along with a whole fake Bluetooth stack this spec has no use for. The
  // flag is set directly instead, as responsive.spec.ts already does: it opens
  // the telemetry and changes nothing about how wide the channel is drawn.
  await page.addInitScript(() => {
    (window as unknown as { __PLAYWRIGHT_TESTING?: boolean }).__PLAYWRIGHT_TESTING = true;
  });
  await page.goto('./');
  await page.locator('.btn-try-demo').click();
  await page.locator('.rower3d-canvas-container').waitFor({ state: 'visible', timeout: 30_000 });
  await expectSceneAlive(page, 'the demo row');

  // The reading only exists once the frame loop has run.
  await expect
    .poll(() => readClearance(page), { timeout: 30_000, intervals: [500] })
    .not.toBeNull();

  const first = await readClearance(page);
  expect(first!.oarReachM, 'the rigged reach changed without this test noticing').toBeCloseTo(
    2.78,
    2,
  );

  // Sampled rather than checked once at the end. The channel width varies by
  // segment and is interpolated between them, so the narrow point is somewhere
  // in the middle of the row - which is exactly where a check at either end
  // would miss it.
  let worst = first!;
  const deadline = Date.now() + WATCH_MS;
  while (Date.now() < deadline) {
    await page.waitForTimeout(250);
    const now = await readClearance(page);
    if (!now) continue;

    expect(
      Number.isFinite(now.clearanceM),
      `the scene stopped measuring its own channel at progress ${now.progress.toFixed(4)}`,
    ).toBe(true);

    expect(
      now.clearanceM,
      `the blades were ${Math.abs(now.clearanceM).toFixed(2)} m over the bank at progress ` +
        `${now.progress.toFixed(4)} - half the channel was ${now.halfWidthM.toFixed(2)} m ` +
        `against a ${now.oarReachM.toFixed(2)} m reach`,
    ).toBeGreaterThan(0);

    if (now.clearanceM < worst.clearanceM) worst = now;
  }

  // The boat has to have gone somewhere, or this watched a stationary scene
  // and proved nothing about the route.
  const last = await readClearance(page);
  expect(last!.progress, 'the boat never moved, so no segment but the first was read').
    toBeGreaterThan(first!.progress);

  console.log(
    `[oar-clearance] narrowest clearance ${worst.clearanceM.toFixed(2)} m at progress ` +
      `${worst.progress.toFixed(4)} (half-width ${worst.halfWidthM.toFixed(2)} m)`,
  );

  expect(errors, 'the page reported errors while rowing').toEqual([]);
});
