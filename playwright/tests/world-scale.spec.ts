import { test, expect } from '../fixtures/crash-watch';
import { expectSceneAlive } from '../utils/scene-health';

/**
 * Issue #321 — the boat moves at the speed the erg says it does.
 *
 * The scene used to be built at three scales at once, and this is the symptom a
 * rower actually felt: the route curve ran at one unit to ten metres while the
 * hull was eight units long, so at 2:00/500m the boat advanced 0.417 units a
 * second along an eight-unit boat and took about nineteen seconds to travel its
 * own length. On water it takes two. The game felt ten times slower than the
 * erg, and no test noticed, because every unit test that touched the curve
 * asserted in the same wrong units the scene was built in.
 *
 * So this measures the one thing those tests could not: where the boat actually
 * is in the world, twice, a known time apart, in the running app. The demo row
 * holds 2:00/500m — 4.17 m/s — so two seconds is 8.3 metres, and a metre is a
 * unit.
 *
 * It lives in its own spec rather than in `rower-stroke.spec.ts`, which VR-01
 * suggested: that one is about whether the rower's arms are driven by the
 * stroke, and shares nothing with this but the demo row it starts from.
 */

/** The demo row's pace, set in App.tsx: 2:00 per 500 m. */
const DEMO_PACE_S_PER_500 = 120;
const DEMO_SPEED_MPS = 500 / DEMO_PACE_S_PER_500;

/** How long to let the boat run between the two readings. */
const SAMPLE_GAP_MS = 2_000;

/**
 * How far the reading may fall from the arithmetic.
 *
 * Generous on purpose. The speed is low-pass filtered on its way into the
 * scene, a bend applies a cosmetic drag multiplier, and a software rasteriser
 * does not deliver frames on a metronome — so this is sized to catch a factor
 * of ten and not to police a few per cent. Before #321 the boat covered 0.83
 * units where the pace says 8.3, which is nowhere near this band.
 */
const TOLERANCE_FRACTION = 0.45;

test('the boat covers the ground its pace says it does', async ({ page }) => {
  test.slow();

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.addInitScript(() => {
    window.__VIRTUALROW_PERFORMANCE_MODE = 'low';
    // The boat's position is published only under automation, and the flag is
    // normally set by the BLE harness — which this spec has no other use for.
    window.__PLAYWRIGHT_TESTING = true;
  });
  await page.goto('./');
  await page.locator('.btn-try-demo').click();
  await page.locator('.rower3d-canvas-container').waitFor({ state: 'visible', timeout: 30_000 });
  await expectSceneAlive(page, 'the world-scale scene');

  // Wait for the boat to be moving before timing it: the first samples are the
  // low-pass filter ramping up from a standstill, which is not the steady state
  // this is about.
  await expect
    .poll(() => page.evaluate(() => window.__ROWER3D_SPEED_MPS ?? 0), {
      timeout: 30_000,
      message: 'the boat never started moving',
    })
    .toBeGreaterThan(DEMO_SPEED_MPS * 0.5);

  const positionNow = () =>
    page.evaluate(() => {
      const pos = window.__ROWER3D_POS;
      return pos ? { x: pos.x, y: pos.y, z: pos.z } : null;
    });

  const before = await positionNow();
  expect(before, 'the scene never published a boat position').not.toBeNull();
  const startedAt = Date.now();

  await page.waitForTimeout(SAMPLE_GAP_MS);

  const after = await positionNow();
  expect(after, 'the scene stopped publishing a boat position').not.toBeNull();
  const elapsedSeconds = (Date.now() - startedAt) / 1000;

  // Straight line rather than along the curve: over a couple of seconds the
  // route is near enough straight that the chord is the distance, and a chord
  // can only ever be the shorter of the two — so this cannot flatter the result.
  const travelled = Math.hypot(
    after!.x - before!.x,
    after!.y - before!.y,
    after!.z - before!.z,
  );
  const expected = DEMO_SPEED_MPS * elapsedSeconds;

  console.log(
    `[world-scale] ${travelled.toFixed(2)} units in ${elapsedSeconds.toFixed(2)}s, ` +
      `pace says ${expected.toFixed(2)} m`,
  );

  expect(
    travelled,
    `the boat covered ${travelled.toFixed(2)} scene units where its pace says ` +
      `${expected.toFixed(2)} metres — the world is not being built in metres`,
  ).toBeGreaterThan(expected * (1 - TOLERANCE_FRACTION));
  expect(travelled).toBeLessThan(expected * (1 + TOLERANCE_FRACTION));
});
