import { test, expect, type Page } from '../fixtures/crash-watch';
import { expectSceneAlive } from '../utils/scene-health';

/**
 * How much of the route load is done, and gone when it really is (#318).
 *
 * The stage used to show one line of static text, dismissed when the scene's
 * code chunk resolved. Measured on the demo route, built app, software
 * rasteriser:
 *
 *   0 ms      "Loading 3D view…" shown
 *   ~690 ms   the chunk arrives (1,145 kB) — and the message goes
 *   ~2,500 ms the river is drawn
 *   ~3,247 ms scull-male.glb finishes (1,960 kB) and the boat appears
 *
 * So the rower was told the wait was over at 0.7 s and it ended at 3.2 s,
 * looking at an empty stage in between while the largest download of the lot
 * was still in flight.
 */

const BAR = '[role="progressbar"]';

const bar = (page: Page) => page.locator(BAR);

const valueNow = async (page: Page): Promise<number | null> => {
  const raw = await page.locator(BAR).first().getAttribute('aria-valuenow').catch(() => null);
  return raw === null ? null : Number(raw);
};

/** The visitor's path onto the stage. */
async function startDemoRow(page: Page) {
  await page.addInitScript(() => {
    (window as unknown as { __PLAYWRIGHT_TESTING?: boolean }).__PLAYWRIGHT_TESTING = true;
  });
  await page.goto('./');
  await page.locator('.btn-try-demo').click();
}

test('the wait is shown from the moment the route is chosen', async ({ page }) => {
  test.slow();
  await startDemoRow(page);

  await expect(bar(page).first()).toBeVisible({ timeout: 5_000 });

  const first = bar(page).first();
  await expect(first).toHaveAttribute('aria-valuemin', '0');
  await expect(first).toHaveAttribute('aria-valuemax', '100');
  await expect(first).toHaveAttribute('aria-label', 'Loading the 3D view');

  // It says what it is waiting for, not just a number.
  const phase = await first.getAttribute('aria-valuetext');
  expect(
    [
      'Fetching the 3D view',
      'Preparing the scene',
      'Drawing the first frame',
      'Loading the boat',
    ],
    `aria-valuetext was ${JSON.stringify(phase)}`,
  ).toContain(phase);
});

test('progress follows work, not a clock', async ({ page }) => {
  test.slow();

  // The chunk is held, so nothing can complete while we watch.
  // Given a real initial value: TypeScript does not track an assignment made
  // inside a Promise executor, and narrows a `null` seed to `never` at the
  // call site below.
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/Rower3D-*.js', async (route) => {
    await held;
    await route.continue();
  });

  await startDemoRow(page);
  await expect(bar(page).first()).toBeVisible({ timeout: 10_000 });

  const before = await valueNow(page);
  await page.waitForTimeout(3_000);
  const after = await valueNow(page);

  // This is the criterion that rules out the easy wrong answer: a bar animated
  // against a fixed duration passes every other scenario here and tells the
  // rower nothing.
  expect(
    after,
    `the bar moved from ${before} to ${after} while no phase completed, so it is on a timer`,
  ).toBe(before);

  release();
});

test('it does not vanish when the code arrives, and goes when the scene is ready', async ({
  page,
}) => {
  test.slow();
  await startDemoRow(page);
  await expect(bar(page).first()).toBeVisible({ timeout: 5_000 });

  // The canvas is in the DOM well before the boat has downloaded. The bar has
  // to still be there - that gap is the whole complaint.
  await page.locator('.rower3d-canvas-container canvas').waitFor({ state: 'attached', timeout: 30_000 });

  // Then it goes, once the scene is drawing and the boat has settled.
  await expect(bar(page).first()).toBeHidden({ timeout: 60_000 });

  await expect
    .poll(() => page.evaluate(() => window.__ROWER3D_RENDER_STATS?.drawCalls ?? 0), {
      timeout: 30_000,
      intervals: [500],
    })
    .toBeGreaterThan(0);

  await expectSceneAlive(page, 'the loaded demo row');
});

test('it only ever moves forward, and reaches 100 before it goes', async ({ page }) => {
  test.slow();
  await startDemoRow(page);
  await expect(bar(page).first()).toBeVisible({ timeout: 5_000 });

  const samples: number[] = [];
  const startedAt = Date.now();
  const deadline = startedAt + 60_000;
  while (Date.now() < deadline) {
    const value = await valueNow(page);
    if (value === null) break; // the bar has gone
    samples.push(value);
    await page.waitForTimeout(100);
  }

  expect(samples.length, 'the bar was never sampled').toBeGreaterThan(2);

  for (let i = 1; i < samples.length; i += 1) {
    expect(
      samples[i],
      `progress went backwards at sample ${i}: ${samples.slice(Math.max(0, i - 3), i + 1).join(' -> ')}`,
    ).toBeGreaterThanOrEqual(samples[i - 1]);
  }

  expect(
    Math.max(...samples),
    `the bar never filled; it reached ${Math.max(...samples)}%`,
  ).toBe(100);

  // And the bar really is gone, rather than the sampling having given up.
  await expect(bar(page).first()).toBeHidden({ timeout: 10_000 });

  // The boat was *seen*, not given up on. useRouteLoadProgress falls back to
  // calling the boat lost after 20s, and that path would also fill the bar and
  // dismiss it - so without this the spec would pass just as happily on a
  // build where the boat never loaded at all. Measured at ~3.2s.
  expect(
    Date.now() - startedAt,
    'the load only finished around the give-up timeout, so the boat may never have arrived',
  ).toBeLessThan(15_000);
});

test('a boat that will not load does not strand the rower', async ({ page }) => {
  test.slow();

  await page.route('**/scull-*.glb', (route) =>
    route.fulfill({ status: 503, contentType: 'text/plain', body: 'nope' }),
  );

  await startDemoRow(page);
  await expect(bar(page).first()).toBeVisible({ timeout: 5_000 });

  // The wait ends rather than stopping at the boat's share.
  await expect(bar(page).first()).toBeHidden({ timeout: 40_000 });

  // And the rower is told why the river has no boat in it.
  await expect(page.getByText('The boat could not be loaded')).toBeVisible({ timeout: 10_000 });

  // The row still happens, which is the point. #266 and #267 set the precedent:
  // an asset that will not load does not take the scene down with it.
  await expect
    .poll(() => page.evaluate(() => window.__ROWER3D_RENDER_STATS?.drawCalls ?? 0), {
      timeout: 30_000,
      intervals: [500],
    })
    .toBeGreaterThan(0);
});
