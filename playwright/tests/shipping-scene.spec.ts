import { test, expect, type Page } from '../fixtures/crash-watch';

/**
 * Issue #419 — the scene automation measures is not the scene that ships.
 *
 * A spec opts into the shipping scene by setting
 * `window.__VIRTUALROW_SHIPPING_SCENE = true` before the SPA boots. The cost
 * gates listed in `dropForCost` then lift — the PMREM sky map, the mirror
 * reflection, the wake, the contact shadow, the ground cover, the horizon
 * silhouette — while telemetry and determinism gates stay untouched.
 *
 * The evidence is the draw-call count: the shipping scene has to draw more
 * than the ordinary automation scene. The exact numbers move as tiers and
 * assets change, so this asserts the direction rather than a target — the
 * shipping frame is strictly heavier than the bare one at the same tier, and
 * the delta is at least a handful of calls (the wake, the horizon and the
 * ground cover alone are worth more than that).
 */
async function measureDrawCalls(target: Page, shipping: boolean): Promise<number> {
  await target.addInitScript((on) => {
    const w = window as unknown as Record<string, unknown>;
    w.__VIRTUALROW_TELEMETRY = true;
    w.__VIRTUALROW_PERFORMANCE_MODE = 'auto';
    if (on) w.__VIRTUALROW_SHIPPING_SCENE = true;
    // Freeze on the hero frame so both runs draw the same content.
    w.__ROWER3D_FREEZE = { time: 12.5, progress: 0.3 };
  }, shipping);
  await target.setViewportSize({ width: 1280, height: 800 });
  await target.goto('./');
  await target.locator('.btn-try-demo').click();
  await expect(target.locator('.activity-view')).toBeVisible({ timeout: 30_000 });

  let previous = -1;
  await expect
    .poll(
      async () => {
        const current = await target.evaluate(
          () => window.__ROWER3D_RENDER_STATS?.drawCalls ?? 0,
        );
        const settled = current > 0 && current === previous;
        previous = current;
        return settled;
      },
      { timeout: 120_000, intervals: [3_000] },
    )
    .toBe(true);

  return target.evaluate(() => window.__ROWER3D_RENDER_STATS!.drawCalls);
}

test('the shipping-scene opt-in draws more than the automation scene', async ({ page }) => {
  test.slow();

  const bare = await page.context().newPage();
  const automationCalls = await measureDrawCalls(bare, false);
  await bare.close();

  const shippingCalls = await measureDrawCalls(page, true);

  console.log(
    `[shipping] automation=${automationCalls} draw calls, shipping=${shippingCalls}`,
  );

  expect(
    shippingCalls,
    `shipping (${shippingCalls}) should exceed automation (${automationCalls})`,
  ).toBeGreaterThan(automationCalls);

  // The wake, the horizon silhouette and the ground cover between them are
  // worth more than five calls at every tier; if the delta collapses to a
  // handful, the flag is quietly no-op again.
  const delta = shippingCalls - automationCalls;
  expect(
    delta,
    `the shipping scene added only ${delta} draw calls, so the opt-in is doing little`,
  ).toBeGreaterThanOrEqual(5);
});
