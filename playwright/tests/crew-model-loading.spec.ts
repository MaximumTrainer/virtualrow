import { test, expect, type Page } from '../fixtures/crash-watch';
import { expectSceneAlive } from '../utils/scene-health';

/**
 * Issue #251 — the crewed sculls are published with the site and both of them
 * load.
 *
 * This spec exists because the app asked for its GLBs from the domain root
 * while the deploy publishes them under `--base=/virtualrow/app/`, so every
 * model 404'd in production. A failed useGLTF surfaces as a fallback boat
 * rather than an error, so the outage looked like a visual choice. The
 * assertions here are therefore about the network: a spec that checked the
 * picker would have passed throughout.
 *
 * Three constraints, each of which cost a CI round trip to learn:
 *
 * 1. It must NOT install `mock-bluetooth.js`. That fixture sets
 *    `window.__PLAYWRIGHT_TESTING`, making `IS_TEST_MODE` true, and Rower3D's
 *    test branch renders the *procedural* RowingScull — GltfScull never mounts
 *    and no crew GLB is ever requested. The demo row needs no hardware, so the
 *    harness is not needed either.
 * 2. The crew is chosen before the row starts; the picker is not part of the
 *    in-workout UI. It is set through its own storage key rather than by
 *    clicking, so the scene is the only 3D work the spec does.
 * 3. It must stay cheap. Running two full demo rows in one page left the macOS
 *    runner unable to draw for later 3D specs — route-performance and
 *    scene-quality-match failed behind it with zero frames, while passing in
 *    the run where this spec bailed early. So: the low tier is forced (which
 *    still mounts the GLB boat, since that branch keys off IS_TEST_MODE and not
 *    the quality), one crew per test so each gets a fresh browser context, and
 *    the row ends as soon as the model has been answered.
 */

const CREW_PREFERENCE_STORAGE_KEY = 'virtualrow:crew';

/** Every response the page received for a crewed scull, with its status. */
function recordCrewResponses(page: Page) {
  const seen: Array<{ url: string; status: number }> = [];
  page.on('response', (response) => {
    if (/scull-(male|female)\.glb(\?|$)/.test(response.url())) {
      seen.push({ url: response.url(), status: response.status() });
    }
  });
  return seen;
}

function recordCrewFailures(page: Page) {
  const failed: string[] = [];
  page.on('requestfailed', (request) => {
    if (/scull-(male|female)\.glb/.test(request.url())) {
      failed.push(`${request.url()} ${request.failure()?.errorText ?? 'failed'}`);
    }
  });
  return failed;
}

/**
 * Pin the crew and the cheapest quality tier before any app code runs.
 *
 * `__VIRTUALROW_PERFORMANCE_MODE` is an explicit override, so it applies
 * without putting the app into test mode — which is what keeps the GLB boat in
 * the scene while making the scene itself cheap.
 */
async function pinSession(page: Page, crew: 'male' | 'female') {
  await page.addInitScript(
    ([key, value]) => {
      (window as unknown as { __VIRTUALROW_PERFORMANCE_MODE?: string })
        .__VIRTUALROW_PERFORMANCE_MODE = 'low';
      try {
        localStorage.setItem(key, value);
      } catch {
        /* storage unavailable; the picker default still applies */
      }
    },
    [CREW_PREFERENCE_STORAGE_KEY, crew] as const,
  );
}

async function startDemoRow(page: Page) {
  const demo = page.locator('.btn-try-demo');
  await expect(demo).toBeVisible({ timeout: 15_000 });
  await demo.click();
  await expect(page.locator('.rower3d-canvas-container')).toBeVisible({ timeout: 30_000 });
  await expectSceneAlive(page, 'the crew scene');
}

async function endWorkout(page: Page) {
  await page.locator('.btn-end-workout').waitFor({ state: 'visible', timeout: 20_000 });
  await page.evaluate(() =>
    (document.querySelector('.btn-end-workout') as HTMLButtonElement | null)?.click(),
  );
}

for (const crew of ['female', 'male'] as const) {
  test(`the ${crew} scull is served, not 404 (#251)`, async ({ page }) => {
    const responses = recordCrewResponses(page);
    const failures = recordCrewFailures(page);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));

    await pinSession(page, crew);
    await page.goto('./');

    // The picker reflects the pinned preference, so the storage key and the UI
    // are known to agree rather than assumed to.
    const label = crew === 'female' ? 'Female' : 'Male';
    await expect(page.getByRole('radio', { name: label, exact: true })).toHaveAttribute(
      'aria-checked',
      'true',
    );

    await startDemoRow(page);

    await expect
      .poll(() => responses.some((r) => r.url.includes(`scull-${crew}.glb`)), {
        timeout: 30_000,
        message: `the ${crew} scull was never requested`,
      })
      .toBe(true);

    // The assertion that would have failed for the whole production outage.
    expect(
      responses.filter((r) => r.status >= 400),
      `the ${crew} scull did not load`,
    ).toEqual([]);
    expect(failures, `the ${crew} scull request failed outright`).toEqual([]);

    // Nothing threw while loading the model. Deliberately not asserting that
    // the canvas is visible: the 3D scene does not render at all right now
    // (#261), and on macOS the canvas reports hidden — so that assertion made
    // this spec fail for a bug it does not cover, which is what turned main red
    // at 5fedb5e. This spec is about the model being served; #261 owns whether
    // the scene draws.
    expect(errors.filter((e) => /scull|glb|gltf/i.test(e))).toEqual([]);

    await endWorkout(page);
  });
}
