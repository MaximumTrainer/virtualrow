import { test, expect, type Page } from '../fixtures/crash-watch';
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

/**
 * Issue #379 — nothing on the demo row stands in the river.
 *
 * The scenery was placed at absolute offsets from the centreline, authored for
 * a narrow channel, so on a wide river the bank dressing and the landmarks
 * stood in the water. Each placement path now reads the water's width at its
 * own progress and stands clear of it by `SCENERY_WATER_MARGIN_METRES`.
 *
 * Unit tests lay the demo route out and measure every placement. What this
 * adds is the running scene: that the components the rower sees are the ones
 * doing the laying out, with the enrichment the game actually loaded. Each
 * path publishes the clearance of its nearest placement - measured across the
 * route against the same width function the water is built from - and this
 * reads them. The GLB kit is switched on at the high tier, as
 * scenery-kit-budgets.spec.ts does, because the low tier automation defaults
 * to does not mount it.
 */
const readSceneryClearance = (page: Page) =>
  page.evaluate(() => window.__ROWER3D_SCENERY_CLEARANCE ?? null);

/** Every path that places something beside the demo route. */
const SCENERY_PATHS = ['landscape', 'foliage', 'scenery-left', 'structures'] as const;

test('nothing on the demo row stands in the river', async ({ page }) => {
  test.slow();

  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.addInitScript(() => {
    const w = window as unknown as {
      __PLAYWRIGHT_TESTING?: boolean;
      __VIRTUALROW_SCENERY_MODELS?: boolean;
      __VIRTUALROW_PERFORMANCE_MODE?: string;
    };
    w.__PLAYWRIGHT_TESTING = true;
    w.__VIRTUALROW_SCENERY_MODELS = true;
    w.__VIRTUALROW_PERFORMANCE_MODE = 'high';
  });
  await page.goto('./');
  await page.locator('.btn-try-demo').click();
  await page.locator('.rower3d-canvas-container').waitFor({ state: 'visible', timeout: 30_000 });
  await expectSceneAlive(page, 'the demo row with its scenery');

  // The GLB paths publish once their first models have loaded, which on a
  // software rasteriser in CI is the slow part.
  await expect
    .poll(
      async () => {
        const readings = await readSceneryClearance(page);
        return SCENERY_PATHS.filter((path) => !readings?.[path]);
      },
      { timeout: 90_000, intervals: [1_000], message: 'a scenery path never reported its clearance' },
    )
    .toEqual([]);

  const readings = (await readSceneryClearance(page))!;
  for (const [path, reading] of Object.entries(readings)) {
    console.log(
      `[scenery-clearance] ${path}: nearest ${reading.nearestM.toFixed(2)} m past the waterline ` +
        `at progress ${reading.progress.toFixed(4)} over ${reading.count} placements`,
    );

    expect(reading.count, `${path} placed nothing, so it proved nothing`).toBeGreaterThan(0);
    expect(
      Number.isFinite(reading.nearestM),
      `${path} stopped measuring its own clearance`,
    ).toBe(true);
    // Held to the margin within a centimetre: the check re-samples the curve
    // at each placement's progress rather than reusing the placement's frame.
    expect(
      reading.nearestM,
      `${path} put something ${reading.nearestM.toFixed(2)} m from the waterline at progress ` +
        `${reading.progress.toFixed(4)}, inside the ${reading.marginM} m margin` +
        (reading.nearestM < 0 ? ' - it is standing in the river' : ''),
    ).toBeGreaterThanOrEqual(reading.marginM - 0.01);
  }

  expect(errors, 'the page reported errors while the scenery loaded').toEqual([]);
});

/**
 * Issue #329 — the blades go in the water and come out again.
 *
 * `strokePose` swept the oars with `sin(phase * 2pi) * 0.5` and nothing else:
 * the blades never squared, never feathered and never touched the water. They
 * scythed over the surface at a constant height for the whole stroke, which is
 * the one thing a sculler never does.
 *
 * Sampled from the running scene rather than from the pose, because the pose
 * is already unit-tested — what this adds is that the GLB oars are actually
 * being driven by it.
 */
test('the blades enter the water on the drive and clear it on the recovery', async ({ page }) => {
  test.slow();

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.addInitScript(() => {
    (window as unknown as { __VIRTUALROW_PERFORMANCE_MODE?: string })
      .__VIRTUALROW_PERFORMANCE_MODE = 'low';
  });
  await page.goto('./');
  await page.locator('.btn-try-demo').click();
  await page.locator('.rower3d-canvas-container').waitFor({ state: 'visible', timeout: 30_000 });
  await expectSceneAlive(page, 'the blade scene');

  await expect
    .poll(() => page.evaluate(() => window.__ROWER3D_BLADE_Y ?? null), {
      timeout: 30_000,
      message: 'the scene never reported where its blades were',
    })
    .not.toBeNull();

  // Sampled across several strokes, so both halves of the cycle are caught
  // whatever phase the scene happened to be at when the polling started.
  const heights: number[] = [];
  for (let i = 0; i < 60; i += 1) {
    const y = await page.evaluate(() => window.__ROWER3D_BLADE_Y ?? null);
    if (y !== null) heights.push(y);
    await page.waitForTimeout(120);
  }

  // A blade height at all means the GLB scull mounted and its frame loop is
  // running, which is the only precondition this check has.
  expect(heights.length, 'no blade heights were sampled').toBeGreaterThan(30);

  const deepest = Math.min(...heights);
  const highest = Math.max(...heights);
  console.log(
    `[blades] deepest ${deepest.toFixed(3)} highest ${highest.toFixed(3)} ` +
      `over ${heights.length} samples`,
  );

  // WATER_SURFACE_Y is -0.1. The blade goes 0.15 m under it on the drive and
  // 0.25 m over it on the recovery, so both sides of the surface are visited.
  expect(deepest, 'the blades never entered the water').toBeLessThan(-0.1);
  expect(highest, 'the blades never came out of the water').toBeGreaterThan(-0.1);
});
