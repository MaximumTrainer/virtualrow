import { test, expect, type Page } from '@playwright/test';

/**
 * Issue #251 — the crewed sculls are published with the site and both of them
 * load.
 *
 * This spec exists because the app asked for its GLBs from the domain root
 * while the deploy publishes them under `--base=/virtualrow/app/`, so every
 * model 404'd in production. Nothing caught it: a failed useGLTF surfaces as a
 * fallback boat rather than an error, so the outage looked like a visual
 * choice.
 *
 * Two things this spec has to get right, both of which cost a CI round trip
 * first time:
 *
 * 1. It must NOT install `mock-bluetooth.js`. That fixture sets
 *    `window.__PLAYWRIGHT_TESTING`, which makes `IS_TEST_MODE` true, and
 *    Rower3D's test branch renders the *procedural* RowingScull — GltfScull
 *    never mounts and no crew GLB is ever requested. The demo row needs no
 *    hardware, so the harness is not needed either.
 * 2. The crew is chosen on the Row screen *before* starting: the picker is not
 *    part of the in-workout UI.
 *
 * The assertions are about the network, not the picker. A spec that checked the
 * radio group would have passed throughout the outage.
 */

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

async function chooseCrew(page: Page, label: 'Male' | 'Female' | 'Auto') {
  const radio = page.getByRole('radio', { name: label, exact: true });
  await radio.waitFor({ state: 'visible', timeout: 15_000 });
  await radio.click();
  await expect(radio).toHaveAttribute('aria-checked', 'true');
}

/** Start the demo row — no hardware, and no test harness. */
async function startDemoRow(page: Page) {
  const demo = page.locator('.btn-try-demo');
  await expect(demo).toBeVisible({ timeout: 15_000 });
  await demo.click();
  await expect(page.locator('.rower3d-canvas-container')).toBeVisible({ timeout: 30_000 });
}

async function endWorkout(page: Page) {
  await page.locator('.btn-end-workout').waitFor({ state: 'visible', timeout: 20_000 });
  await page.evaluate(() =>
    (document.querySelector('.btn-end-workout') as HTMLButtonElement | null)?.click(),
  );
}

test.describe('crewed sculls load for either rower (#251)', () => {
  test('both crew models are served, not 404, when the rower switches', async ({ page }) => {
    const responses = recordCrewResponses(page);
    const failures = recordCrewFailures(page);

    await page.setViewportSize({ width: 1280, height: 800 });

    for (const crew of ['Female', 'Male'] as const) {
      await page.goto('./');
      await chooseCrew(page, crew);
      await startDemoRow(page);
      // Give the GLB time to be requested and answered.
      await expect
        .poll(
          () => responses.some((r) => r.url.includes(`scull-${crew.toLowerCase()}.glb`)),
          { timeout: 30_000, message: `the ${crew} scull was never requested` },
        )
        .toBe(true);
      await endWorkout(page);
    }

    // Every fetch must have succeeded. This is the assertion that would have
    // failed for the whole production outage.
    expect(
      responses.filter((r) => r.status >= 400),
      'a crewed scull did not load',
    ).toEqual([]);
    expect(failures, 'a crewed scull request failed outright').toEqual([]);
  });

  test('the scene survives loading a crew model', async ({ page }) => {
    // A crew model that fails to load used to be able to take the scene with
    // it; the point of loading both is that the boat survives the switch.
    //
    // No draw-call assertion here: __ROWER3D_RENDER_STATS is only published
    // under IS_TEST_MODE, and this spec has to stay out of test mode or the
    // GLB boat never mounts at all. What is observable without the harness is
    // that the canvas is real and nothing threw.
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const responses = recordCrewResponses(page);

    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('./');
    await chooseCrew(page, 'Female');
    await startDemoRow(page);

    await expect
      .poll(() => responses.some((r) => r.url.includes('scull-female.glb')), {
        timeout: 30_000,
        message: 'the female scull was never requested',
      })
      .toBe(true);

    const canvas = page.locator('.rower3d-canvas-container canvas');
    await expect(canvas).toBeVisible();
    const box = await canvas.boundingBox();
    expect(box?.width ?? 0).toBeGreaterThan(0);
    expect(box?.height ?? 0).toBeGreaterThan(0);

    expect(responses.filter((r) => r.status >= 400)).toEqual([]);
    expect(errors.filter((e) => /scull|glb|gltf/i.test(e))).toEqual([]);
  });
});
