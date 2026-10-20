import { test, expect, type Page } from '../fixtures/crash-watch';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { expectSceneAlive } from '../utils/scene-health';
import { LAKE_VERTEX_CAP } from '../../src/components/rower3d/constants';

/**
 * #493 AC5 (FR7, NFR1): over a 30 s traverse of the lake fixture, `high` holds
 * >= 55 fps and `basic` >= 30 fps, and the lake outline never draws more
 * vertices than the tier's cap.
 *
 * The lake is rownative course 1, Quinsigamond, from the recorded mirror
 * fixture. Overpass is answered with the recorded response for that course
 * (src/__tests__/fixtures/osm/1.json), so enrichment runs the real detection
 * path and finds the lake, its islands and its outline; OpenTopoData is
 * answered with a flat 146 m, the lake's surface, so the elevation half is
 * deterministic too. Nothing reaches a third-party host.
 *
 * What is enforced where, following route-performance-budgets.spec.ts and
 * default-route-performance.spec.ts:
 *
 * - The vertex cap is held on every renderer. It is what the scene asks the GPU
 *   to draw, not how fast anything draws it: `__ROWER3D_LAKE` is read on every
 *   animation frame of the traverse, and its `peakVertices` covers any frame in
 *   between.
 * - The outline is held to be drawing (more than zero vertices), so the frame
 *   rate below is the lake path's and not the ribbon's.
 * - The fps floors (55 high, 30 basic) are the issue's numbers, unchanged, and
 *   are asserted only where a hardware GPU is drawing. The suite's Playwright
 *   config draws through SwiftShader on every CI leg (Linux, Windows, macOS),
 *   where this scene runs at a frame or two a second at any tier, so there the
 *   frame rate is measured and logged, not asserted - an fps floor on
 *   SwiftShader would describe the rasteriser, not the engine. What CI does
 *   assert is that the scene kept producing frames through the traverse, at
 *   the tier asked for, with its WebGL context intact. Run with BASE_URL and a
 *   GPU-backed browser to have the floors enforced.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mockBluetoothPath = path.resolve(__dirname, '../mock-bluetooth.js');
const lakeCoursePath = path.resolve(__dirname, '../../src/__tests__/fixtures/rownative/1.json');
const lakeOsmPath = path.resolve(__dirname, '../../src/__tests__/fixtures/osm/1.json');

const LAKE_COURSE = JSON.parse(fs.readFileSync(lakeCoursePath, 'utf8')) as {
  id: string;
  name: string;
  country: string;
  distance_m: number;
  status: string;
};
const LAKE_OSM = JSON.parse(fs.readFileSync(lakeOsmPath, 'utf8')) as { elements: unknown[] };

/** Lake Quinsigamond's surface, near enough, for every elevation asked. */
const LAKE_ELEVATION_M = 146;

const OVERPASS = /overpass-api\.de\/api\/interpreter/;
const ELEVATION = /api\.opentopodata\.org/;

const ONE_BY_ONE_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);

/** #493 AC5's floors, in frames per second. */
const FPS_FLOOR = { high: 55, basic: 30 } as const;

const TRAVERSE_SECONDS = 30;
/** One PM5 reading per this many ms of the traverse. */
const READING_MS = 250;
/** 2:00/500m: a steady piece, so the boat genuinely crosses water. */
const METRES_PER_SECOND = 500 / 120;

type Tier = keyof typeof FPS_FLOOR;

async function openLake(page: Page, tier: Tier) {
  await page.addInitScript({ content: fs.readFileSync(mockBluetoothPath, 'utf8') });
  await page.addInitScript((mode) => {
    const w = window as unknown as Record<string, unknown>;
    w.__VIRTUALROW_PERFORMANCE_MODE = mode;
    w.__VIRTUALROW_TELEMETRY = true;
    w.__VIRTUALROW_LAKE_OUTLINES = true;
    // Let enrichment's requests out of the page, to be answered below.
    w.__E2E_ENRICHMENT_NETWORK = true;
  }, tier);

  await page.route('**/rownative/courses/**/index.json', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        { id: LAKE_COURSE.id, name: LAKE_COURSE.name, country: LAKE_COURSE.country, distance_m: LAKE_COURSE.distance_m, status: LAKE_COURSE.status },
      ]),
    }),
  );
  await page.route(`**/rownative/courses/**/${LAKE_COURSE.id}.json`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(LAKE_COURSE) }),
  );
  await page.route('**/rawcdn.githack.com/**/*.png', (route) =>
    route.fulfill({ status: 200, contentType: 'image/png', body: ONE_BY_ONE_PNG }),
  );
  await page.route(OVERPASS, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ elements: LAKE_OSM.elements }) }),
  );
  await page.route(ELEVATION, (route) => {
    const locations = (new URL(route.request().url()).searchParams.get('locations') ?? '').split('|').filter(Boolean);
    const results = locations.map((pair) => {
      const [lat, lng] = pair.split(',').map(Number);
      return { elevation: LAKE_ELEVATION_M, location: { lat, lng } };
    });
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ results, status: 'OK' }) });
  });

  await page.goto(`./?rownativeCourseId=${LAKE_COURSE.id}`);
  await expect(page.locator('.route-info-overlay h2')).toContainText('Quinsig', { timeout: 20_000 });
}

async function connectAndStart(page: Page) {
  const deviceConnected = (name: string) =>
    page.waitForFunction((name) => {
      const containers = Array.from(document.querySelectorAll('.bluetooth-device-container'));
      const device = containers.find((c) => String(c.querySelector('.device-name')?.textContent).includes(name));
      return String(device?.querySelector('.device-status')?.textContent).includes('Connected');
    }, name, { timeout: 20_000 });

  await page.click('button:has-text("Connect PM5")');
  await deviceConnected('Concept2 PM5');
  await page.click('button:has-text("Connect HR Monitor")');
  await deviceConnected('Heart Rate Monitor');

  await expect(page.locator('.btn-start-workout')).toBeEnabled({ timeout: 10_000 });
  await page.evaluate(() => (document.querySelector('.btn-start-workout') as HTMLButtonElement | null)?.click());
  await expect(page.locator('.activity-view')).toBeVisible({ timeout: 25_000 });
}

/** Same question the other performance specs ask: is a frame rate here the engine's? */
async function isSoftwareRendered(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    try {
      const gl = document.createElement('canvas').getContext('webgl2') as WebGL2RenderingContext | null;
      if (!gl) return true;
      const info = gl.getExtension('WEBGL_debug_renderer_info');
      const name = String(info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : '');
      return /swiftshader|llvmpipe|software|angle \(google/i.test(name);
    } catch {
      return true;
    }
  });
}

interface Traverse {
  /** The frame stats at the end of each ten-second window of the traverse. */
  windows: Array<{ frames: number; fps: number; p95Ms: number }>;
  /** The most outline vertices any sampled frame drew, and the scene's own peak. */
  maxSampledVertices: number;
  peakVertices: number;
  vertexSamples: number;
  progress: [number, number];
  /** Render-stats timestamps at the start and end: the loop advanced if they differ. */
  sampledAt: [number, number];
}

/**
 * Row for thirty seconds of wall clock, from inside the page so the cost is
 * the page's and not a round trip per reading. PM5 frames are in the wire
 * format `src/vendor/pm5-base.js` parses (general status, then additional).
 */
function traverse(page: Page): Promise<Traverse> {
  return page.evaluate(
    async ({ seconds, readingMs, metresPerSecond }) => {
      type Characteristic = { _dispatch: (v: DataView) => void };
      const w = window as unknown as { __pm5CharGeneral?: Characteristic; __pm5CharAdditional?: Characteristic };
      const reading = (elapsed: number) => {
        const cs = Math.round(elapsed * 100);
        const dm = Math.round(elapsed * metresPerSecond * 10);
        const general = new Uint8Array(11);
        general[0] = cs & 0xff; general[1] = (cs >> 8) & 0xff; general[2] = (cs >> 16) & 0xff;
        general[3] = dm & 0xff; general[4] = (dm >> 8) & 0xff; general[5] = (dm >> 16) & 0xff;
        general[10] = 2; // strokeState = rowing
        w.__pm5CharGeneral?._dispatch(new DataView(general.buffer));
        const speed = Math.round(metresPerSecond * 1000);
        const additional = new Uint8Array(11);
        additional[0] = cs & 0xff; additional[1] = (cs >> 8) & 0xff; additional[2] = (cs >> 16) & 0xff;
        additional[3] = speed & 0xff; additional[4] = (speed >> 8) & 0xff;
        additional[5] = 24; // stroke rate
        additional[6] = 130; // heart rate
        additional[7] = 0xe0; additional[8] = 0x2e; // currentPace 120.00 s/500m
        additional[9] = 0xe0; additional[10] = 0x2e; // averagePace
        w.__pm5CharAdditional?._dispatch(new DataView(additional.buffer));
      };

      let maxSampledVertices = 0;
      let vertexSamples = 0;
      let watching = true;
      const watch = () => {
        if (!watching) return;
        const lake = window.__ROWER3D_LAKE;
        if (lake) {
          vertexSamples += 1;
          maxSampledVertices = Math.max(maxSampledVertices, lake.vertices);
        }
        requestAnimationFrame(watch);
      };
      requestAnimationFrame(watch);

      const startProgress = window.__ROWER3D_POS?.progress ?? 0;
      const startSampledAt = window.__ROWER3D_RENDER_STATS?.sampledAt ?? 0;
      const windows: Array<{ frames: number; fps: number; p95Ms: number }> = [];
      const started = performance.now();
      let nextWindow = 10_000;
      for (let elapsed = 0; performance.now() - started < seconds * 1000; elapsed += readingMs / 1000) {
        reading(elapsed);
        await new Promise((resolve) => setTimeout(resolve, readingMs));
        if (performance.now() - started >= nextWindow) {
          nextWindow += 10_000;
          const stats = window.__ROWER3D_FRAME_STATS;
          windows.push({ frames: stats?.frames ?? 0, fps: stats?.fps ?? 0, p95Ms: stats?.p95Ms ?? Infinity });
        }
      }
      watching = false;

      return {
        windows,
        maxSampledVertices,
        peakVertices: window.__ROWER3D_LAKE?.peakVertices ?? 0,
        vertexSamples,
        progress: [startProgress, window.__ROWER3D_POS?.progress ?? 0] as [number, number],
        sampledAt: [startSampledAt, window.__ROWER3D_RENDER_STATS?.sampledAt ?? 0] as [number, number],
      };
    },
    { seconds: TRAVERSE_SECONDS, readingMs: READING_MS, metresPerSecond: METRES_PER_SECOND },
  );
}

test.describe('the lake outline at speed (#493 AC5)', () => {
  for (const tier of ['high', 'basic'] as const) {
    test(`holds ${tier}'s frame rate and vertex cap over a 30 s lake traverse`, async ({ page }) => {
      test.slow();
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));

      await openLake(page, tier);
      await connectAndStart(page);
      await expectSceneAlive(page, `the ${tier} lake scene`);

      // Detection found the lake and the scene is drawing its outline, not the
      // ribbon: the frame rate below is the lake path's.
      await expect
        .poll(() => page.evaluate(() => window.__ROWER3D_LAKE?.vertices ?? 0), {
          message: `${tier}: the lake outline never drew`,
          timeout: 60_000,
          intervals: [1000],
        })
        .toBeGreaterThan(0);

      const result = await traverse(page);
      const lake = await page.evaluate(() => window.__ROWER3D_LAKE!);
      const renderStats = await page.evaluate(() => window.__ROWER3D_RENDER_STATS ?? null);
      const software = await isSoftwareRendered(page);
      const worstFps = Math.min(...result.windows.map((w) => w.fps));

      console.log(
        `${tier}: fps per 10 s window ${result.windows.map((w) => `${w.fps.toFixed(1)} (${w.frames} frames, p95 ${w.p95Ms.toFixed(0)}ms)`).join(', ')}; ` +
          `worst ${worstFps.toFixed(1)} against ${FPS_FLOOR[tier]} ${software ? '(recorded, software rasteriser)' : '(enforced)'}; ` +
          `lake vertices ${lake.vertices}, peak ${result.peakVertices}, max sampled ${result.maxSampledVertices} ` +
          `over ${result.vertexSamples} frames, cap ${LAKE_VERTEX_CAP[tier]}; ` +
          `progress ${result.progress[0].toFixed(4)} -> ${result.progress[1].toFixed(4)}; software=${software}`,
      );

      expect(lake.performanceMode, 'the tier override did not take').toBe(tier);
      expect(renderStats?.performanceMode, 'the scene drew at another tier').toBe(tier);
      expect(lake.cap).toBe(LAKE_VERTEX_CAP[tier]);

      // FR9: never more than the tier's cap, on any frame.
      expect(result.vertexSamples, `${tier}: no frame was sampled`).toBeGreaterThan(0);
      expect(result.maxSampledVertices, `${tier}: a frame drew the outline`).toBeGreaterThan(0);
      expect(result.maxSampledVertices).toBeLessThanOrEqual(LAKE_VERTEX_CAP[tier]);
      expect(result.peakVertices).toBeLessThanOrEqual(LAKE_VERTEX_CAP[tier]);

      // The scene kept drawing through the traverse, on every renderer.
      expect(result.windows.length, `${tier}: the traverse was cut short`).toBe(TRAVERSE_SECONDS / 10);
      expect(result.windows.every((w) => w.frames > 0), `${tier}: a window had no frames`).toBe(true);
      expect(result.sampledAt[1], `${tier}: the render loop stopped`).toBeGreaterThan(result.sampledAt[0]);

      if (!software) {
        // NFR1, the issue's numbers, wherever a GPU is drawing.
        expect(worstFps, `${tier}: under ${FPS_FLOOR[tier]} fps on the lake`).toBeGreaterThanOrEqual(FPS_FLOOR[tier]);
        expect(result.progress[1], `${tier}: the boat never moved`).toBeGreaterThan(result.progress[0]);
      }

      const context = await page.evaluate(() => window.__ROWER3D_CONTEXT_STATE ?? null);
      expect(context?.losses ?? 0, `${tier}: the WebGL context was lost`).toBe(0);
      expect(errors, `${tier}: the scene raised errors`).toEqual([]);
    });
  }
});
