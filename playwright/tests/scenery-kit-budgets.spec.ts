import { test, expect, type Page } from '@playwright/test';
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
 * The ceiling is well above the limit itself because several scenery components
 * mount at once and each is entitled to its own chunk, and because this runs
 * against the dev server, where StrictMode mounts everything twice. Measured:
 * 15 on a production build, 27 here, against 57 before the kit was chunked. So
 * the number catches a return to loading the whole kit in one breath without
 * failing on StrictMode's doubling.
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
    ).toBeLessThanOrEqual(32);
  }
});
