import { test, expect, type Page } from '../fixtures/crash-watch';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { expectSceneAlive } from '../utils/scene-health';

/**
 * Issue #232 phase 3 — what the GLB scenery kit costs.
 *
 * The kit was opt-in until its cost was validated, and both call sites also
 * carried `!IS_TEST_MODE`, so it could never render under automation: the thing
 * that had to be measured was exempt from measurement. The gate now answers
 * "has the kit been asked for" rather than "are we in a test", and this spec
 * asks for it and holds it to the same #224 budgets as the bare scene.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mockBluetoothPath = path.resolve(__dirname, '../mock-bluetooth.js');

const METERS_PER_DEGREE_LAT = 111_195;

function windingCourse(points: number, lengthMeters: number, bends: number, amplitude = 60) {
  const originLat = 51.45;
  const lngScale = METERS_PER_DEGREE_LAT * Math.cos((originLat * Math.PI) / 180);
  return Array.from({ length: points }, (_, i) => {
    const t = i / (points - 1);
    return [
      (Math.sin(t * bends * 2 * Math.PI) * amplitude) / lngScale,
      originLat + (t * lengthMeters) / METERS_PER_DEGREE_LAT,
    ];
  });
}

function geoJsonFile(name: string, coordinates: number[][]) {
  return {
    name: `${name}.geojson`,
    mimeType: 'application/geo+json',
    buffer: Buffer.from(
      JSON.stringify({
        type: 'Feature',
        properties: { name },
        geometry: { type: 'LineString', coordinates },
      }),
    ),
  };
}

/** Turn the kit on, and render at full quality so the measurement is worth taking. */
async function enableSceneryKit(page: Page) {
  await page.addInitScript(() => {
    (window as unknown as { __VIRTUALROW_SCENERY_MODELS?: boolean }).__VIRTUALROW_SCENERY_MODELS =
      true;
    (window as unknown as { __VIRTUALROW_PERFORMANCE_MODE?: string }).__VIRTUALROW_PERFORMANCE_MODE =
      'high';
  });
}

/** Same flow the #224 budget spec uses — the app's real controls, not guesses. */
async function waitForDeviceConnected(page: Page, deviceLabel: string) {
  await page.waitForFunction(
    (label) => {
      const containers = Array.from(document.querySelectorAll('.bluetooth-device-container'));
      const target = containers.find((c) =>
        c.querySelector('.device-name')?.textContent?.includes(label),
      );
      return target?.querySelector('.device-status')?.textContent?.includes('Connected') ?? false;
    },
    deviceLabel,
    { timeout: 10_000 },
  );
}

async function connectHardwareAndStart(page: Page) {
  await page.getByRole('button', { name: 'Connect PM5', exact: true }).click();
  await waitForDeviceConnected(page, 'Concept2 PM5');
  await page.evaluate(() => {
    const containers = Array.from(document.querySelectorAll('.bluetooth-device-container'));
    const hr = containers.find((c) =>
      c.querySelector('.device-name')?.textContent?.includes('Heart Rate Monitor'),
    );
    (hr?.querySelector('button.btn-connect') as HTMLButtonElement)?.click();
  });
  await waitForDeviceConnected(page, 'Heart Rate Monitor');

  await expect(page.locator('.btn-start-workout')).toBeEnabled({ timeout: 10_000 });
  await page.evaluate(() => {
    (document.querySelector('.btn-start-workout') as HTMLButtonElement)?.click();
  });
  await expect(page.locator('.rower3d-canvas-container')).toBeVisible({ timeout: 30_000 });
  await expectSceneAlive(page, 'the scenery kit scene');
}

async function rowGeneratedCourse(page: Page, routeName: string, coordinates: number[][]) {
  await enableSceneryKit(page);
  await page.addInitScript({ content: fs.readFileSync(mockBluetoothPath, 'utf8') });
  await page.goto('./');

  await page.getByRole('button', { name: 'Routes', exact: true }).click();
  await page.getByRole('button', { name: /import a file/i }).click();
  await page.getByLabel('Route name').fill(routeName);
  await page
    .locator('.route-import input[type="file"]')
    .setInputFiles(geoJsonFile(routeName, coordinates));
  await expect(page.locator('.route-info-overlay h2')).toContainText(routeName, {
    timeout: 30_000,
  });

  await connectHardwareAndStart(page);
}

test('the scenery kit renders under automation at all', async ({ page }) => {
  await enableSceneryKit(page);
  await page.addInitScript({ content: fs.readFileSync(mockBluetoothPath, 'utf8') });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(`${error.message}
${error.stack ?? ''}`));
  await page.goto('./');

  await expect(page.locator('.route-info-overlay h2')).toContainText('Willowbrook River');
  await connectHardwareAndStart(page);
  await page.waitForFunction(() => window.__ROWER3D_ROUTE?.hasCurve === true, undefined, {
    timeout: 30_000,
  });

  // The GLBs load through Suspense; give them a chance to arrive and be counted.
  await expect
    .poll(async () => page.evaluate(() => window.__ROWER3D_MEMORY?.geometries ?? 0), {
      timeout: 60_000,
      intervals: [1000],
    })
    .toBeGreaterThan(0);

  // Nothing is excused here any more: `parent` was fixed by #233 and `alpha`
  // by #257, so both are real failures if they return.
  expect(errors, 'the scenery kit raised errors while dressing the route').toEqual([]);
});

test('a 20 km route stays inside the geometry budget with the kit on', async ({ page }) => {
  await rowGeneratedCourse(page, 'Twenty Kilometre Kit Course', windingCourse(4000, 20_000, 16));

  await page.waitForFunction(() => (window.__ROWER3D_MEMORY?.geometries ?? 0) > 0, undefined, {
    timeout: 60_000,
  });

  let previous = -1;
  await expect
    .poll(
      async () => {
        const current = await page.evaluate(() => window.__ROWER3D_MEMORY?.geometryBytes ?? 0);
        const settled = current === previous;
        previous = current;
        return settled;
      },
      { timeout: 120_000, intervals: [2000] },
    )
    .toBe(true);

  const memory = await page.evaluate(() => window.__ROWER3D_MEMORY!);
  console.log(
    `[glb kit] geometry ${memory.geometryMb.toFixed(2)} MB across ${memory.geometries} geometries, ` +
      `${memory.textures} textures`,
  );

  // The same 80 MB ceiling #224 sets for the bare scene: the kit has to fit
  // inside the existing budget, not be given its own.
  expect(memory.geometryMb).toBeLessThanOrEqual(80);
});

/**
 * Issue #333 — a forest is a handful of draw calls.
 *
 * The bank trees were eleven meshes each, so the demo route could afford about
 * forty of them and the hero camera looked down a lake between two lawns. The
 * billboard foliage is one instanced mesh per species, and what that buys is
 * asserted here on the renderer's own count: the demo row, frozen at the hero's
 * frame, with the foliage on and then off. The difference is what the forest
 * costs, and it must not grow with the forest.
 *
 * At `auto`, because that is the lowest tier with a shadow pass: each species
 * is drawn once into the shadow map as well, so three species cost six.
 */
test('a forest of hundreds of trees costs a handful of draw calls', async ({ page }) => {
  test.slow();

  const measure = async (target: Page, foliage: boolean) => {
    await target.addInitScript((on) => {
      const w = window as unknown as Record<string, unknown>;
      w.__VIRTUALROW_TELEMETRY = true;
      w.__VIRTUALROW_PERFORMANCE_MODE = 'auto';
      w.__VIRTUALROW_FOLIAGE = on;
      // The same frame on both runs: the hero's, which is where the trees are.
      w.__ROWER3D_FREEZE = { time: 12.5, progress: 0.3 };
    }, foliage);
    await target.setViewportSize({ width: 1280, height: 800 });
    await target.goto('./');
    await target.locator('.btn-try-demo').click();
    await expect(target.locator('.activity-view')).toBeVisible({ timeout: 30_000 });

    // Until the count stops moving: the route's chunks build progressively.
    let previous = -1;
    await expect
      .poll(
        async () => {
          const current = await target.evaluate(() => window.__ROWER3D_RENDER_STATS?.drawCalls ?? 0);
          const settled = current > 0 && current === previous;
          previous = current;
          return settled;
        },
        { timeout: 90_000, intervals: [3_000] },
      )
      .toBe(true);

    return target.evaluate(() => ({
      drawCalls: window.__ROWER3D_RENDER_STATS!.drawCalls,
      foliage: window.__ROWER3D_FOLIAGE ?? null,
    }));
  };

  const bare = await page.context().newPage();
  const without = await measure(bare, false);
  await bare.close();
  const withForest = await measure(page, true);

  console.log(
    `[foliage] ${withForest.foliage?.trees} trees in ${withForest.foliage?.meshes} meshes, ` +
      `${withForest.foliage?.drawn} in sight: ${without.drawCalls} draw calls without, ` +
      `${withForest.drawCalls} with`,
  );

  expect(without.foliage, 'the foliage was drawn with the foliage switched off').toBeNull();
  expect(withForest.foliage!.trees, 'the demo route was not planted as a forest').toBeGreaterThanOrEqual(400);
  expect(withForest.foliage!.drawn, 'no tree was in sight of the hero frame').toBeGreaterThan(0);
  const cost = withForest.drawCalls - without.drawCalls;
  expect(cost, `the forest cost ${cost} draw calls`).toBeGreaterThan(0);
  expect(cost, `the forest cost ${cost} draw calls`).toBeLessThanOrEqual(6);
});

/**
 * The kit must not flood a static host.
 *
 * A demo row handed the loader all 58 models at once — 57 fetches in flight —
 * and GitHub Pages answered one of them with 503:
 *
 *   Could not load .../tier-f/f12-bluff-steep.glb: ... responded with 503
 *
 * The file was fine; fetched on its own it returns 200 and 31,232 bytes. Only
 * the volume was wrong, and it was only reachable at all once #251 fixed the
 * asset URLs — before that every request 404'd instantly and cost nothing.
 *
 * The ceiling is above the limit itself because several scenery components
 * mount at once and each is entitled to its own chunk. It used to be 32,
 * which was sized for the dev server: StrictMode mounted everything twice
 * there, taking a production build's 15 up to 27. The suite runs the built app
 * now, where CI measures a peak of 10 - so 32 was three times the observed
 * value, and a regression tripling parallel fetches would have passed the test
 * written to catch exactly that (#287).
 *
 * 20 leaves room for the components that legitimately mount together without
 * leaving room for the flood.
 */
test('the scenery kit does not open a flood of parallel fetches', async ({ page }) => {
  let inFlight = 0;
  let peak = 0;
  page.on('request', (request) => {
    if (/\.glb(\?|$)/.test(request.url())) {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
    }
  });
  page.on('requestfinished', (request) => {
    if (/\.glb(\?|$)/.test(request.url())) inFlight -= 1;
  });
  page.on('requestfailed', (request) => {
    if (/\.glb(\?|$)/.test(request.url())) inFlight -= 1;
  });

  await rowGeneratedCourse(page, 'Kit Concurrency Course', windingCourse(600, 3_000, 4));
  await page.waitForTimeout(12_000);

  console.log(`[kit] peak concurrent GLB fetches ${peak}`);

  // Only meaningful if the kit actually loaded something.
  if (peak > 0) {
    expect(
      peak,
      `the kit put ${peak} GLB fetches in flight at once — a static host answers that with 503`,
    ).toBeLessThanOrEqual(20);
  }
});

/**
 * Issue #332 — what a row actually downloads.
 *
 * The kit shipped uncompressed: 130 GLBs at 11.7 MB plus 5.7 MB of sculls, and
 * a route fetches every model its placement plan names. The counts above say
 * how many requests a row makes and how many run at once; neither says what any
 * of them weighs, so the kit could have doubled in size without a single test
 * noticing.
 *
 * Measured on the wire, from the built app, because that is the number a rower
 * on a phone pays.
 */
const isGlb = (url: string): boolean => url.split('?')[0].toLowerCase().endsWith('.glb');

test('a row downloads a few megabytes of scenery, compressed', async ({ page }) => {
  const glbs: { url: string; bytes: number }[] = [];

  page.on('response', async (response) => {
    if (!isGlb(response.url())) return;
    try {
      const body = await response.body();
      glbs.push({ url: response.url(), bytes: body.byteLength });
    } catch {
      // A response whose body has already gone (redirect, abort) says nothing
      // about size, and counting it as zero would understate the total.
    }
  });

  await rowGeneratedCourse(page, 'Kit Bytes Course', windingCourse(600, 3_000, 4));
  await page.waitForTimeout(12_000);

  const total = glbs.reduce((sum, glb) => sum + glb.bytes, 0);
  console.log(`[kit] ${glbs.length} GLBs, ${(total / 1024 / 1024).toFixed(2)} MB transferred`);

  // Only meaningful if the kit actually loaded something.
  test.skip(glbs.length === 0, 'the kit loaded no models on this run');

  expect(
    total,
    `the row pulled ${(total / 1024 / 1024).toFixed(2)} MB of scenery`,
  ).toBeLessThanOrEqual(4 * 1024 * 1024);

  /**
   * Every model is meshopt-encoded, which is what makes that total reachable.
   * A GLB carries its extension list in the JSON chunk, so this reads the bytes
   * that actually arrived rather than trusting the manifest that said they
   * would.
   */
  const uncompressed: string[] = [];
  for (const glb of glbs) {
    const body = await (await page.request.get(glb.url)).body();
    const jsonLength = body.readUInt32LE(12);
    const json = body.subarray(20, 20 + jsonLength).toString('utf8');
    if (!json.includes('EXT_meshopt_compression')) uncompressed.push(glb.url.split('/').pop()!);
  }

  expect(uncompressed, `shipped uncompressed: ${uncompressed.join(', ')}`).toEqual([]);
});
