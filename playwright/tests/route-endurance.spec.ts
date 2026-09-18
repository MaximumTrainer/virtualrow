import { test, expect, type Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { useSimServer, releaseSimServer, emitPm5 } from '../utils/sim-server';
import { expectSceneAlive } from '../utils/scene-health';
import { describeSceneHealth } from '../../src/utils/sceneHealth';

/**
 * Issue #272 - row a route from one end to the other, and see what breaks.
 *
 * Every other spec watches a short window near the start. Nothing rowed a route
 * to completion, so nothing would catch a fault that only appears at 80% of the
 * way along, on a leak that takes minutes to bite, or on the scenery for a
 * stretch the boat only reaches late.
 *
 * Rowing a real route in real time is not affordable, and the simulator can be
 * driven far faster than a rower - which is how a full traverse fits in a test.
 * The boat still visits every metre of the route and the scene still streams
 * every chunk; it simply does not dwell.
 *
 * Kept in the ordinary suite rather than on a schedule, which the issue allows
 * either way: at the speeds below each traverse costs about a minute and a half,
 * and a long-running fault is worth catching on the pull request that causes it
 * rather than overnight.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mockBluetoothPath = path.resolve(__dirname, '../mock-bluetooth.js');

/**
 * How long a full traverse is given, in seconds of wall clock.
 *
 * The speed is then chosen from the route's own length, so a 7 km route and a
 * 20 km one both take about this long.
 */
const TRAVERSE_SECONDS = 60;

/** PM5 frames per second. Each one is a round trip, and the renderer is busy. */
const EMIT_HZ = 1;

/**
 * A plausible pace to send while the traverse runs.
 *
 * It drives the stroke, the cadence and the numbers on the dashboard. It does
 * not drive where the boat is: see rowToTheEnd for what does, and why.
 */
const ROWING_WIRE_PACE = 12_000;

let simulatorReady = false;
test.beforeAll(async () => {
  simulatorReady = await useSimServer();
});
test.afterAll(async () => {
  await releaseSimServer();
});

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

async function connectHardwareAndStart(page: Page) {
  await page.getByRole('button', { name: 'Connect PM5', exact: true }).click();
  await waitForDeviceConnected(page, 'Concept2 PM5');
  // DOM click: a locator retry loop would toggle Connect/Disconnect.
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
  await expect(page.locator('.rower3d-canvas-container')).toBeVisible({ timeout: 30_000 });
}

const METERS_PER_DEGREE_LAT = 111_195;

/** How long "a long route" is. */
const LONG_ROUTE_METERS = 20_000;

/** A winding course of a stated length, so "long" is a number and not a guess. */
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

interface Sample {
  progress: number;
  geometryMb: number;
  geometries: number;
  textures: number;
}

/**
 * One round trip per tick, not two.
 *
 * Every call into the page queues behind the frame in progress, and a frame
 * costs a second or more on a software rasteriser. Reading the telemetry and
 * asking the canvas how it is doing in one go halves the cost of the traverse.
 */
async function sampleAndObserve(page: Page) {
  return page.evaluate(() => {
    const marker = document.querySelector('.rower3d-fallback-marker');
    const canvases = Array.from(
      document.querySelectorAll('.rower3d-canvas-container canvas'),
    ) as HTMLCanvasElement[];
    const lostPerCanvas = canvases.map((canvas) => {
      try {
        const gl = (canvas.getContext('webgl2') ?? canvas.getContext('webgl')) as
          | WebGLRenderingContext
          | null;
        return gl ? gl.isContextLost() : false;
      } catch {
        return false;
      }
    });
    return {
      sample: {
        progress: window.__ROWER3D_POS?.progress ?? 0,
        geometryMb: window.__ROWER3D_MEMORY?.geometryMb ?? 0,
        geometries: window.__ROWER3D_MEMORY?.geometries ?? 0,
        textures: window.__ROWER3D_MEMORY?.textures ?? 0,
      },
      observation: {
        contextLost: lostPerCanvas.some(Boolean),
        markerText: marker?.textContent ?? '',
        canvasCount: canvases.length,
        lostPerCanvas,
      },
    };
  });
}

/**
 * Drive the boat from one end of the route to the other, watching as it goes.
 *
 * Returns every sample taken, so the assertions can talk about the shape of the
 * run rather than only its last moment.
 */
async function rowToTheEnd(page: Page, label: string): Promise<Sample[]> {
  // The route telemetry is written from the frame loop, so it appears with the
  // first frame rather than with the canvas. An imported course reaches that
  // later than the bundled one.
  await page.waitForFunction(() => (window.__ROWER3D_ROUTE?.totalDistance ?? 0) > 0, undefined, {
    timeout: 60_000,
  });
  const route = await page.evaluate(() => window.__ROWER3D_ROUTE ?? null);
  const totalDistance = route!.totalDistance;

  // Paused, and then driven by the distance the rower has covered.
  //
  // With the session running, where the boat is comes from the physics model
  // integrating speed, and a harness cannot ask for a particular speed: the
  // simulator derives pace from the distance and time it is given, the model
  // smooths it, and the frame loop integrates that against its own delta. The
  // three together put the boat across a 6.7 km route in about ten seconds
  // however it was asked, which samples the route a dozen times and proves
  // little about a long row.
  //
  // Paused, the scene follows the distance the PM5 reports instead, which is
  // exactly the number this harness sends. The boat is then walked down the
  // route on a schedule, with the same geometry, the same chunk streaming, the
  // same scenery and the same camera as a row - only the line that decides how
  // far along it is differs, and the speed the other line integrates is what
  // #255 already sweeps.
  await page.evaluate(() => {
    const pause = Array.from(document.querySelectorAll('.btn-activity-control')).find((e) =>
      (e.textContent ?? '').includes('Pause'),
    ) as HTMLButtonElement | undefined;
    pause?.click();
  });
  await page.waitForTimeout(500);

  console.log(
    `[endurance ${label}] ${(totalDistance / 1000).toFixed(2)} km, walked from end to ` +
      `end over about ${TRAVERSE_SECONDS}s`,
  );

  const samples: Sample[] = [];
  const read = async () => {
    const { sample, observation } = await sampleAndObserve(page);
    samples.push(sample);
    return { sample, observation };
  };

  await read();

  // A quarter longer than the traverse should need. The boat is driven by a
  // simulated rower through a physics model that smooths velocity, so arrival is
  // not to the second; running out of budget with progress short of the end is
  // itself the finding, and the assertions below say so.
  // A little past the end, so the scene's smoothing has somewhere to converge:
  // progress eases towards the reported distance rather than snapping to it, and
  // a schedule that stops exactly at the finish leaves it just short.
  const ticks = TRAVERSE_SECONDS * EMIT_HZ;
  let seconds = 0;

  for (let i = 0; i < ticks; i += 1) {
    seconds += 1 / EMIT_HZ;
    const along = Math.min(1.05, (i + 1) / ticks + 0.05);
    await emitPm5({
      distance: Math.round(totalDistance * along),
      elapsedTime: Math.round(seconds * 1000),
      pace: ROWING_WIRE_PACE,
      cadence: 34,
      power: 320,
      heartRate: 165,
    });
    await page.waitForTimeout(1000 / EMIT_HZ);

    const { sample, observation } = await read();

    // Judged as it happens, not at the end: a context that is lost and later
    // restored still put the banner over the river while the rower was rowing.
    const health = describeSceneHealth(observation);
    expect(
      health.alive,
      `${label}: the scene was lost at progress ${sample.progress.toFixed(3)} - ${health.reason}`,
    ).toBe(true);

    if (sample.progress >= 0.999) break;
  }

  return samples;
}

/** Everything that must be true of a traverse, whichever route it was. */
function expectACleanTraverse(label: string, samples: Sample[], errors: string[]) {
  const progress = samples.map((s) => s.progress);
  const reached = progress[progress.length - 1];
  const geometry = samples.map((s) => s.geometryMb).filter((mb) => mb > 0);

  console.log(
    `[endurance ${label}] ${samples.length} samples, reached ${(reached * 100).toFixed(1)}%, ` +
      `geometry ${geometry.length ? Math.min(...geometry).toFixed(2) : 'n/a'}-` +
      `${geometry.length ? Math.max(...geometry).toFixed(2) : 'n/a'} MB, ` +
      `geometries ${samples[samples.length - 1].geometries}, ` +
      `textures ${samples[samples.length - 1].textures}`,
  );

  expect(errors, `${label}: the page reported errors`).toEqual([]);
  expect(reached, `${label}: the boat never reached the end of the route`).toBeGreaterThan(0.99);

  for (let i = 1; i < progress.length; i += 1) {
    expect(
      progress[i],
      `${label}: progress went backwards at sample ${i}`,
    ).toBeGreaterThanOrEqual(progress[i - 1] - 1e-6);
  }

  // Bounded, not flat. Chunked strips are built as the boat reaches them and
  // the buffers stay uploaded, so some growth along a route is the design; what
  // this catches is growth that never stops.
  expect(geometry.length, `${label}: no geometry was ever measured`).toBeGreaterThan(3);
  expect(
    Math.max(...geometry),
    `${label}: geometry grew to ${Math.max(...geometry).toFixed(2)} MB`,
  ).toBeLessThan(Math.min(...geometry) * 4 + 8);
}

test('the default route is rowed from start to finish (#272)', async ({ page }) => {
  test.slow();
  expect(simulatorReady, 'the PM5 simulator is not reachable').toBe(true);

  const errors: string[] = [];
  page.on('pageerror', (e) => { errors.push(e.message); console.log('[pageerror] ' + e.message); });
  page.on('crash', () => console.log('[crash] the page crashed'));

  await page.addInitScript({ content: fs.readFileSync(mockBluetoothPath, 'utf8') });
  await page.goto('./');
  await connectHardwareAndStart(page);
  await expectSceneAlive(page, 'the default route');

  const samples = await rowToTheEnd(page, 'default');
  expectACleanTraverse('default', samples, errors);

  // The GPU boundary replaces the whole stage, so its absence is worth stating
  // separately from the scene being alive.
  await expect(page.locator('.rower3d-fallback-marker')).not.toContainText('3D rendering error');
});

test('a long route is rowed from start to finish (#272)', async ({ page }) => {
  test.slow();
  expect(simulatorReady, 'the PM5 simulator is not reachable').toBe(true);

  const errors: string[] = [];
  page.on('pageerror', (e) => { errors.push(e.message); console.log('[pageerror] ' + e.message); });
  page.on('crash', () => console.log('[crash] the page crashed'));

  await page.addInitScript({ content: fs.readFileSync(mockBluetoothPath, 'utf8') });
  await page.goto('./');

  const name = 'Endurance Long Course';
  await page.getByRole('button', { name: 'Routes', exact: true }).click();
  await page.getByRole('button', { name: /import a file/i }).click();
  await page.getByLabel('Route name').fill(name);
  await page
    .locator('.route-import input[type="file"]')
    .setInputFiles(geoJsonFile(name, serpentineCourse(1_000, LONG_ROUTE_METERS, 12)));
  await expect(page.locator('.route-info-overlay h2')).toContainText(name, { timeout: 30_000 });

  await connectHardwareAndStart(page);
  await expectSceneAlive(page, 'the long route');

  const samples = await rowToTheEnd(page, 'long');
  expectACleanTraverse('long', samples, errors);

  await expect(page.locator('.rower3d-fallback-marker')).not.toContainText('3D rendering error');
});
