import { test, expect, type Page } from '../fixtures/crash-watch';
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


/** PM5 frames per second. Each one is a round trip, and the renderer is busy. */
const EMIT_HZ = 1;

/**
 * The pace the traverse is rowed at, in seconds per 500 m.
 *
 * Far faster than a person - the issue sanctions that, because rowing a route
 * in real time is not affordable - but as fast as the wire can carry. The PM5
 * frame holds speed in millimetres per second in sixteen bits, so anything
 * quicker than 65.5 m/s cannot be expressed, and the mock now refuses to wrap
 * it (#296). 8 s/500 m is 62.5 m/s, which crosses the bundled route in about
 * 110 seconds and the 20 km one in about five minutes.
 */
const TRAVERSE_PACE_SECONDS = 8;

/** What that pace means, and what the scene should therefore do. */
const TRAVERSE_MPS = 500 / TRAVERSE_PACE_SECONDS;

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
  /** JS heap in megabytes, where the browser will say. 0 where it will not. */
  heapMb: number;
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
        heapMb:
          (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory
            ?.usedJSHeapSize != null
            ? (performance as unknown as { memory: { usedJSHeapSize: number } }).memory
                .usedJSHeapSize /
              (1024 * 1024)
            : 0,
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

  const samples: Sample[] = [];
  const read = async () => {
    const { sample, observation } = await sampleAndObserve(page);
    samples.push(sample);
    return { sample, observation };
  };

  await read();

  // Rowed, not seeked.
  //
  // This used to pause the session and drive the boat from the distance the
  // PM5 reported, on the belief that a harness could not ask the physics for a
  // particular speed. It can: speed is 500 / pace, and what made that look
  // otherwise was a pace field overflowing sixteen bits in the mock and a
  // hundredfold unit error in App (#282, #296).
  //
  // Rowing it properly matters, because a paused session returns early from
  // workoutService.updateSessionWithPM5Data - so the sampler never records, no
  // splits are generated, and the session accumulates nothing. Those are the
  // structures that grow over a long row, which is what this spec is for.
  console.log(
    `[endurance ${label}] ${(totalDistance / 1000).toFixed(2)} km at ` +
      `${TRAVERSE_MPS} m/s, so about ${Math.round(totalDistance / TRAVERSE_MPS)}s`,
  );

  // Half as long again as the arithmetic says, because the boat accelerates
  // from a standstill and the frame loop integrates against real time.
  const deadline = Date.now() + (totalDistance / TRAVERSE_MPS) * 1500 + 30_000;
  let distance = 0;
  let seconds = 0;

  while (Date.now() < deadline) {
    seconds += 1 / EMIT_HZ;
    distance += TRAVERSE_MPS / EMIT_HZ;
    const delivered = await emitPm5({
      distance: Math.round(distance),
      // Seconds. The mock converts to the wire's centiseconds itself.
      elapsedTime: Math.round(seconds),
      pace: TRAVERSE_PACE_SECONDS,
      cadence: 34,
      power: 320,
      heartRate: 165,
    });
    expect(delivered, `${label}: the simulator stopped accepting frames`).toBe(true);
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

  // Bounded, and measured where it can actually grow.
  //
  // The geometry figure comes from walking the scene, and both the segment
  // count and the chunk count are capped by constants - so it cannot grow
  // without bound whatever happens, and a generous ceiling on it asserted
  // almost nothing. The renderer's own counters are the ones that catch a
  // geometry detached from the scene and never disposed, which scene.traverse
  // cannot see at all, and the heap is what catches the row's own accumulation
  // (#293).
  const meanOf = (values: number[]) =>
    values.length ? values.reduce((sum, v) => sum + v, 0) / values.length : 0;
  const quarter = Math.max(1, Math.floor(samples.length / 4));
  const early = samples.slice(0, quarter);
  const late = samples.slice(-quarter);

  for (const [what, read] of [
    ['uploaded geometries', (s: Sample) => s.geometries],
    ['uploaded textures', (s: Sample) => s.textures],
  ] as const) {
    const first = meanOf(early.map(read));
    const last = meanOf(late.map(read));
    console.log(`[endurance ${label}] ${what}: ${first.toFixed(1)} -> ${last.toFixed(1)}`);

    // Some growth is the design - the scenery for a stretch is built as the
    // boat reaches it. What this catches is growth that never stops.
    expect(
      last,
      `${label}: ${what} grew from ${first.toFixed(1)} to ${last.toFixed(1)} across the row`,
    ).toBeLessThan(first * 1.5 + 8);
  }

  const heaps = samples.map((s) => s.heapMb).filter((mb) => mb > 0);
  if (heaps.length >= 8) {
    const first = meanOf(heaps.slice(0, Math.max(1, Math.floor(heaps.length / 4))));
    const last = meanOf(heaps.slice(-Math.max(1, Math.floor(heaps.length / 4))));
    console.log(`[endurance ${label}] heap: ${first.toFixed(1)} -> ${last.toFixed(1)} MB`);

    expect(
      last,
      `${label}: the heap grew from ${first.toFixed(1)} to ${last.toFixed(1)} MB across the row`,
    ).toBeLessThan(first * 2 + 64);
  } else {
    console.log(`[endurance ${label}] heap: not reported by this browser`);
  }

  expect(geometry.length, `${label}: no geometry was ever measured`).toBeGreaterThan(3);
  expect(
    Math.max(...geometry),
    `${label}: geometry reached ${Math.max(...geometry).toFixed(2)} MB`,
  ).toBeLessThan(4);
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
