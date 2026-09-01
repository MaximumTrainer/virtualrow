import { test, expect, type Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

/**
 * Issue #224 — the scene has to come up quickly whatever route is loaded, and
 * stay correct once the geometry is built in pieces.
 *
 * These specs measure the app's own `performance.measure`, not a wall clock in
 * the test: the marks bracket exactly the work the issue names — from asking
 * for the route curve to the scene's first tick.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mockBluetoothPath = path.resolve(__dirname, '../mock-bluetooth.js');

const FIRST_FRAME_MEASURE = 'virtualrow:route-to-first-frame';

const METERS_PER_DEGREE_LAT = 111_195;

/**
 * A serpentine course of `points` GPS fixes — the shape that used to cost the
 * most: dense input, constant curvature, nothing collinear to throw away
 * without measuring.
 */
function serpentineCourse(points: number, lengthMeters: number, bends: number) {
  const originLat = 51.45;
  const lngScale = METERS_PER_DEGREE_LAT * Math.cos((originLat * Math.PI) / 180);
  return Array.from({ length: points }, (_, i) => {
    const t = i / (points - 1);
    return [
      (Math.sin(t * bends * 2 * Math.PI) * 45) / lngScale,
      originLat + (t * lengthMeters) / METERS_PER_DEGREE_LAT,
    ];
  });
}

/** A closed loop: the last fix is the first one, so the strip meets itself. */
function loopCourse(points: number, radiusMeters: number) {
  const originLat = 51.45;
  const lngScale = METERS_PER_DEGREE_LAT * Math.cos((originLat * Math.PI) / 180);
  return Array.from({ length: points }, (_, i) => {
    const angle = (i / (points - 1)) * 2 * Math.PI;
    return [
      (Math.sin(angle) * radiusMeters) / lngScale,
      originLat + ((Math.cos(angle) - 1) * radiusMeters) / METERS_PER_DEGREE_LAT,
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

/** Import a generated course, connect the mocked hardware, and start rowing it. */
async function rowGeneratedCourse(
  page: Page,
  routeName: string,
  coordinates: number[][],
): Promise<string[]> {
  const mockBluetoothScript = fs.readFileSync(mockBluetoothPath, 'utf8');
  await page.addInitScript({ content: mockBluetoothScript });

  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });

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

  await page.getByRole('button', { name: 'Connect PM5', exact: true }).click();
  await waitForDeviceConnected(page, 'Concept2 PM5');

  // DOM click: the locator retry loop would toggle Connect/Disconnect.
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
  return errors;
}

/** The app's own measure, once the scene has ticked at least once. */
async function firstFrameMeasureMs(page: Page): Promise<number> {
  await page.waitForFunction(
    (name) => performance.getEntriesByName(name).length > 0,
    FIRST_FRAME_MEASURE,
    { timeout: 30_000 },
  );
  return page.evaluate(
    (name) => performance.getEntriesByName(name)[0].duration,
    FIRST_FRAME_MEASURE,
  );
}

test('a 10,000-point route reaches its first frame promptly', async ({ page }) => {
  const errors = await rowGeneratedCourse(
    page,
    'Dense Serpentine',
    serpentineCourse(10_000, 12_000, 10),
  );

  const firstFrameMs = await firstFrameMeasureMs(page);
  console.log(`route curve to first frame: ${firstFrameMs.toFixed(1)} ms`);

  // Deliberately loose. Issue #224 sets a 150 ms target, and a cold page on a
  // quiet machine measures 85-90 ms — but this number also carries Vite's
  // on-demand transforms, SwiftShader context creation and whatever else is
  // sharing the box: the same page measures 1,013 ms with four specs running
  // beside it. A tight bound here would be measuring the machine. This ceiling
  // only catches a scene that never comes up; the deterministic guarantee —
  // that a dense import does not become a dense spline — is asserted in
  // `routeGeometryResolution.test.ts`, where no clock is involved.
  expect(firstFrameMs).toBeLessThan(3000);

  expect(
    errors.filter((text) => /typeerror|referenceerror|cannot read properties/i.test(text)),
  ).toEqual([]);
});

test('the chunked strips keep the boat on a continuous path down a long route', async ({
  page,
}) => {
  await rowGeneratedCourse(page, 'Long Winding Course', serpentineCourse(4000, 20_000, 14));

  // Every chunk of water and bank finishes building in the background; nothing
  // may move the boat while they arrive.
  const positions = await page.evaluate(async () => {
    const samples: Array<{ x: number; z: number; progress: number }> = [];
    for (let i = 0; i < 40; i++) {
      await new Promise((resolve) => requestAnimationFrame(resolve));
      const pos = window.__ROWER3D_POS;
      if (pos) samples.push({ x: pos.x, z: pos.z, progress: pos.progress });
    }
    return samples;
  });

  expect(positions.length).toBeGreaterThan(10);
  const jumps = positions.slice(1).map((p, i) => Math.hypot(p.x - positions[i].x, p.z - positions[i].z));
  expect(Math.max(...jumps)).toBeLessThan(5);
});

test('a closed-loop course renders and rows without a seam in the geometry', async ({ page }) => {
  const errors = await rowGeneratedCourse(page, 'Closed Loop Lake', loopCourse(600, 400));

  await page.waitForFunction(() => window.__ROWER3D_ROUTE?.hasCurve === true, undefined, {
    timeout: 30_000,
  });
  const route = await page.evaluate(() => window.__ROWER3D_ROUTE);
  expect(route?.curveLength).toBeGreaterThan(0);

  // A loop brings the far end of the route back alongside the boat, which is
  // where progress-band culling would blank water the rower is looking at.
  const positions = await page.evaluate(async () => {
    const samples: Array<{ x: number; z: number }> = [];
    for (let i = 0; i < 40; i++) {
      await new Promise((resolve) => requestAnimationFrame(resolve));
      const pos = window.__ROWER3D_POS;
      if (pos) samples.push({ x: pos.x, z: pos.z });
    }
    return samples;
  });
  const jumps = positions
    .slice(1)
    .map((p, i) => Math.hypot(p.x - positions[i].x, p.z - positions[i].z));
  expect(Math.max(...jumps)).toBeLessThan(5);

  expect(
    errors.filter((text) => /typeerror|referenceerror|cannot read properties/i.test(text)),
  ).toEqual([]);
});
