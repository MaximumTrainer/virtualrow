import { test, expect, type Page } from '../fixtures/crash-watch';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { useSimServer, releaseSimServer, emitPm5 } from '../utils/sim-server';
import { describeSceneHealth } from '../../src/utils/sceneHealth';

/**
 * Issue #301 — find out whether the tab really does die on a heavy traverse.
 *
 * While building #272 an earlier, heavier harness killed the tab twice, about
 * four ticks into a 20 km course of 2000 points: "Execution context was
 * destroyed, most likely because of a navigation", with the app coming back at
 * the setup view and the rower device disconnected. Nothing in src/ navigates
 * during a workout and no `crash` event fired, so the likely reading is the
 * renderer being killed and the tab restored.
 *
 * The shipped traverse makes one round trip per tick over a 1000-point course
 * and passes. That reduction was made for cost, and it stopped the failure
 * happening — it did not explain it. This spec puts the heavy shape back so the
 * question can be answered rather than avoided.
 *
 * Scheduled rather than run on every push, which is what #272's fourth
 * criterion allows for. It is deliberately expensive: two round trips a tick at
 * 2 Hz over 2000 points is the configuration that failed, not a convenient one.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mockBluetoothPath = path.resolve(__dirname, '../mock-bluetooth.js');

/** The course that failed: twice the points of the one that passes. */
const POINTS = 2_000;
const LENGTH_METERS = 20_000;
const BENDS = 24;

/** The cadence that failed, in frames per second of PM5 data. */
const EMIT_HZ = 2;

/** 8 s/500m is 62.5 m/s — as fast as the PM5 frame's speed field can carry. */
const TRAVERSE_PACE_SECONDS = 8;
const TRAVERSE_MPS = 500 / TRAVERSE_PACE_SECONDS;

const METERS_PER_DEGREE_LAT = 111_195;

let simulatorReady = false;
test.beforeAll(async () => {
  simulatorReady = await useSimServer();
});
test.afterAll(async () => {
  await releaseSimServer();
});

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

async function waitForDeviceConnected(page: Page, label: string) {
  await page.waitForFunction(
    (l) => {
      const containers = Array.from(document.querySelectorAll('.bluetooth-device-container'));
      const target = containers.find((c) =>
        c.querySelector('.device-name')?.textContent?.includes(l),
      );
      return target?.querySelector('.device-status')?.textContent?.includes('Connected') ?? false;
    },
    label,
    { timeout: 15_000 },
  );
}

test('a 20 km course of 2000 points survives a heavy harness (#301)', async ({ page }) => {
  test.slow();
  expect(simulatorReady, 'the PM5 simulator is not reachable').toBe(true);

  // Everything that might name the cause, recorded rather than logged and lost.
  const errors: string[] = [];
  let crashed = false;
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('crash', () => {
    crashed = true;
    errors.push('the page crashed');
  });
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text().slice(0, 200)}`);
  });

  await page.addInitScript({ content: fs.readFileSync(mockBluetoothPath, 'utf8') });
  await page.goto('./');

  const name = 'Heavy Stress Course';
  await page.getByRole('button', { name: 'Routes', exact: true }).click();
  await page.getByRole('button', { name: /import a file/i }).click();
  await page.getByLabel('Route name').fill(name);
  await page
    .locator('.route-import input[type="file"]')
    .setInputFiles(geoJsonFile(name, serpentineCourse(POINTS, LENGTH_METERS, BENDS)));
  await expect(page.locator('.route-info-overlay h2')).toContainText(name, { timeout: 60_000 });

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
  await expect(page.locator('.btn-start-workout')).toBeEnabled({ timeout: 15_000 });
  await page.evaluate(() =>
    (document.querySelector('.btn-start-workout') as HTMLButtonElement)?.click(),
  );
  await expect(page.locator('.rower3d-canvas-container')).toBeVisible({ timeout: 60_000 });

  await page.waitForFunction(() => (window.__ROWER3D_ROUTE?.totalDistance ?? 0) > 0, undefined, {
    timeout: 90_000,
  });
  const totalDistance = await page.evaluate(() => window.__ROWER3D_ROUTE?.totalDistance ?? 0);

  // Deliberately two round trips a tick, which is the shape that failed.
  const deadline = Date.now() + (totalDistance / TRAVERSE_MPS) * 1500 + 60_000;
  let distance = 0;
  let seconds = 0;
  let ticks = 0;
  let lastProgress = 0;
  let heapMb = 0;

  while (Date.now() < deadline) {
    seconds += 1 / EMIT_HZ;
    distance += TRAVERSE_MPS / EMIT_HZ;
    await emitPm5({
      distance: Math.round(distance),
      elapsedTime: Math.round(seconds),
      pace: TRAVERSE_PACE_SECONDS,
      cadence: 34,
      power: 320,
      heartRate: 165,
    });
    await page.waitForTimeout(1000 / EMIT_HZ);
    ticks += 1;

    // Two separate calls into the page, as the failing harness made.
    const telemetry = await page.evaluate(() => ({
      progress: window.__ROWER3D_POS?.progress ?? 0,
      heap:
        (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory
          ?.usedJSHeapSize ?? 0,
    }));
    const observation = await page.evaluate(() => {
      const marker = document.querySelector('.rower3d-fallback-marker');
      const canvases = Array.from(
        document.querySelectorAll('.rower3d-canvas-container canvas'),
      ) as HTMLCanvasElement[];
      const lostPerCanvas = canvases.map((canvas) => {
        try {
          const gl = canvas.getContext('webgl2') as WebGL2RenderingContext | null;
          return gl ? gl.isContextLost() : false;
        } catch {
          return false;
        }
      });
      return {
        contextLost: lostPerCanvas.some(Boolean),
        markerText: marker?.textContent ?? '',
        canvasCount: canvases.length,
        lostPerCanvas,
      };
    });

    lastProgress = telemetry.progress;
    heapMb = telemetry.heap / (1024 * 1024);

    const health = describeSceneHealth(observation);
    expect(
      health.alive,
      `the scene was lost at tick ${ticks}, progress ${lastProgress.toFixed(3)}, ` +
        `heap ${heapMb.toFixed(1)} MB - ${health.reason}`,
    ).toBe(true);

    if (lastProgress >= 0.999) break;
  }

  console.log(
    `[stress] ${ticks} ticks, reached ${(lastProgress * 100).toFixed(1)}%, ` +
      `heap ${heapMb.toFixed(1)} MB, errors ${errors.length}`,
  );
  if (errors.length) console.log(`[stress] ${errors.slice(0, 10).join(' | ')}`);

  expect(crashed, 'the renderer was killed').toBe(false);
  expect(errors, 'the page reported errors').toEqual([]);
  expect(lastProgress, 'the boat never reached the end of the route').toBeGreaterThan(0.99);
});
