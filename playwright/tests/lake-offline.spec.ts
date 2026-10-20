import { test, expect, type Browser, type Page } from '../fixtures/crash-watch';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { expectSceneAlive } from '../utils/scene-health';
import { simPortsForWorker } from '../utils/simPorts';

/**
 * #493 AC8 (FR10, NFR5): with Overpass unreachable, a lake row still finishes,
 * draws the ordinary water ribbon, and saves exactly the session it would have
 * saved with lake outlines switched off.
 *
 * The lake is rownative course 1, Quinsigamond - the lake-with-islands course
 * of the OSM reference set - served from the recorded mirror fixture. Overpass
 * and OpenTopoData are aborted at the network layer, so enrichment takes its
 * fallback path; the lake outline has nothing to draw from.
 *
 * The two rows are made identical rather than compared loosely. The page clock
 * is pinned, because a session takes its id, start, end, duration and every
 * timestamp from `Date`, and moved on once, by the time rowed, just before the
 * reading that crosses the line. Both rows are fed the same PM5 frames,
 * stopping at that reading so nothing lands between the finish and the
 * summary. Nothing in the saved JSON is normalised.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mockBluetoothPath = path.resolve(__dirname, '../mock-bluetooth.js');
const lakeCoursePath = path.resolve(__dirname, '../../src/__tests__/fixtures/rownative/1.json');

const LAKE_COURSE = JSON.parse(fs.readFileSync(lakeCoursePath, 'utf8')) as {
  id: string;
  name: string;
  country: string;
  distance_m: number;
  status: string;
};

const ATHLETE = { id: 'i12345', name: 'Test Athlete', email: 'athlete@example.com' };
const SESSIONS_KEY = `virtualrow:sessions:${ATHLETE.id}`;

/** Every `new Date()` the row makes reads this. */
const PINNED_TIME = new Date('2026-06-01T07:00:00Z');

const OVERPASS = /overpass-api\.de\/api\/interpreter/;
const ELEVATION = /api\.opentopodata\.org/;

const ONE_BY_ONE_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);

/** One PM5 reading every ten seconds of the erg's clock, at 2:05/500m. */
const FRAME_SECONDS = 10;
const METRES_PER_SECOND = 4;

interface LakeRow {
  saved: string;
  overpassAttempts: number;
  overpassResponses: number;
  elevationAttempts: number;
  ribbonHalfWidthM: number;
  waterDetections: number;
}

/**
 * Open the app signed in, on the lake, with the enrichment hosts unreachable.
 *
 * Signing in the way `activity-upload.spec.ts` does: a seeded user and refresh
 * token, and a stubbed token endpoint. Only a signed-in row is kept locally.
 */
async function openLakeOffline(page: Page, lakeOutlines: boolean, traffic: LakeRow) {
  await page.addInitScript({ content: fs.readFileSync(mockBluetoothPath, 'utf8') });
  await page.addInitScript(
    ({ athlete, lakeOutlines }) => {
      window.__AUTH_USER = athlete;
      sessionStorage.setItem('vr_auth_user', JSON.stringify(athlete));
      sessionStorage.setItem('vr_auth_refresh_token', 'e2e-refresh-token');
      window.__VIRTUALROW_LAKE_OUTLINES = lakeOutlines;
      // The crash-watch fixture refuses the enrichment hosts in the page; this
      // spec blocks them at the network instead, to see the requests go out.
      (window as unknown as { __E2E_ENRICHMENT_NETWORK?: boolean }).__E2E_ENRICHMENT_NETWORK = true;
    },
    { athlete: ATHLETE, lakeOutlines },
  );
  await page.clock.setFixedTime(PINNED_TIME);

  await page.route('**/proxy/api/oauth/token**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ access_token: 'e2e-access-token', expires_in: 3600, token_type: 'Bearer', athlete_id: 12345 }),
    }),
  );
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
  // The drei cloud texture is the scene's one other download; served here so
  // the row is offline end to end, as virtualrow.spec.ts does for its heroes.
  await page.route('**/rawcdn.githack.com/**/*.png', (route) =>
    route.fulfill({ status: 200, contentType: 'image/png', body: ONE_BY_ONE_PNG }),
  );
  await page.route(OVERPASS, (route) => {
    traffic.overpassAttempts += 1;
    return route.abort('internetdisconnected');
  });
  await page.route(ELEVATION, (route) => {
    traffic.elevationAttempts += 1;
    return route.abort('internetdisconnected');
  });
  page.on('response', (response) => {
    if (OVERPASS.test(response.url())) traffic.overpassResponses += 1;
  });

  await page.goto(`./?rownativeCourseId=${LAKE_COURSE.id}`);
  await expect(page.locator('.route-info-overlay h2')).toContainText('Quinsig', { timeout: 20_000 });
}

async function connectDevices(page: Page) {
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
}

/**
 * Send the PM5 readings for `fromSeconds` to `toSeconds` of the erg's clock.
 *
 * General status then additional status for each reading, wire format as
 * `src/vendor/pm5-base.js` parses it. Sent from inside the page in one call, so
 * the cost is the page's and not a round trip per frame.
 */
function sendReadings(page: Page, fromSeconds: number, toSeconds: number) {
  return page.evaluate(
    async ({ fromSeconds, toSeconds, frameSeconds, metresPerSecond }) => {
      type Characteristic = { _dispatch: (v: DataView) => void };
      const w = window as unknown as { __pm5CharGeneral?: Characteristic; __pm5CharAdditional?: Characteristic };
      const general = (metres: number, seconds: number) => {
        const v = new Uint8Array(11);
        const cs = Math.round(seconds * 100);
        v[0] = cs & 0xff; v[1] = (cs >> 8) & 0xff; v[2] = (cs >> 16) & 0xff;
        const dm = Math.round(metres * 10);
        v[3] = dm & 0xff; v[4] = (dm >> 8) & 0xff; v[5] = (dm >> 16) & 0xff;
        v[10] = 2; // strokeState = rowing
        w.__pm5CharGeneral?._dispatch(new DataView(v.buffer));
      };
      const additional = (seconds: number, heartRate: number) => {
        const v = new Uint8Array(11);
        const cs = Math.round(seconds * 100);
        v[0] = cs & 0xff; v[1] = (cs >> 8) & 0xff; v[2] = (cs >> 16) & 0xff;
        v[3] = 0xa0; v[4] = 0x0f;   // speed 4.000 m/s
        v[5] = 24;                  // stroke rate
        v[6] = heartRate;
        v[7] = 0xd4; v[8] = 0x30;   // currentPace 125.00 s/500m
        v[9] = 0xd4; v[10] = 0x30;  // averagePace
        w.__pm5CharAdditional?._dispatch(new DataView(v.buffer));
      };

      for (let seconds = fromSeconds; seconds <= toSeconds; seconds += frameSeconds) {
        general(seconds * metresPerSecond, seconds);
        additional(seconds, 120 + Math.min(40, Math.floor(seconds / 30)));
        // A frame's worth of breathing room, so the scene keeps drawing.
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    },
    { fromSeconds, toSeconds, frameSeconds: FRAME_SECONDS, metresPerSecond: METRES_PER_SECOND },
  );
}

/**
 * Row the whole course: the same readings, in the same order, every time.
 *
 * Everything short of the line goes first. Then the pinned clock moves on by
 * the time rowed, so the session ends with a real duration, and only then the
 * one reading that crosses the line - nothing can end the row before the clock
 * has moved, and nothing is sent after the finish.
 */
async function rowToTheFinish(page: Page, routeMetres: number) {
  const finishMetres = routeMetres * 1.01;
  const lastSeconds = Math.ceil(finishMetres / METRES_PER_SECOND / FRAME_SECONDS) * FRAME_SECONDS;
  await sendReadings(page, 0, lastSeconds - FRAME_SECONDS);
  await page.clock.setFixedTime(PINNED_TIME.getTime() + lastSeconds * 1000);
  await sendReadings(page, lastSeconds, lastSeconds);
}

async function rowTheLake(page: Page, lakeOutlines: boolean): Promise<LakeRow> {
  const row: LakeRow = {
    saved: '',
    overpassAttempts: 0,
    overpassResponses: 0,
    elevationAttempts: 0,
    ribbonHalfWidthM: 0,
    waterDetections: 0,
  };
  const label = `the lake row with outlines ${lakeOutlines ? 'on' : 'off'}`;

  await openLakeOffline(page, lakeOutlines, row);
  await connectDevices(page);

  await page.evaluate(() => {
    window.__VIRTUALROW_AUTO_FINISH = true;
  });
  await expect(page.locator('.btn-start-workout')).toBeEnabled({ timeout: 10_000 });
  await page.evaluate(() => (document.querySelector('.btn-start-workout') as HTMLButtonElement | null)?.click());
  await expect(page.locator('.activity-view')).toBeVisible({ timeout: 25_000 });
  await expectSceneAlive(page, label);

  // Enrichment asked, was refused, and fell back before the boat moved.
  await expect.poll(() => row.overpassAttempts, { message: `${label}: Overpass was never asked` }).toBeGreaterThan(0);
  await page.waitForFunction(() => window.__ROWER3D_CLEARANCE !== undefined, undefined, { timeout: 30_000 });

  const routeMetres = await page.evaluate(() => window.__ROWER3D_ROUTE?.totalDistance ?? 0);
  expect(routeMetres, `${label}: the route has no length`).toBeGreaterThan(1_000);
  await rowToTheFinish(page, routeMetres);

  await expect(page.getByTestId('finish-banner')).toBeVisible({ timeout: 20_000 });
  // The ribbon, read while the scene is still up: the water's half-width at the boat.
  row.ribbonHalfWidthM = await page.evaluate(() => window.__ROWER3D_CLEARANCE?.halfWidthM ?? 0);
  await expectSceneAlive(page, `${label}, at the finish`);

  await expect(page.locator('.session-summary-modal')).toBeVisible({ timeout: 20_000 });
  row.saved = await page.evaluate((key) => localStorage.getItem(key) ?? '', SESSIONS_KEY);
  row.waterDetections = await page.evaluate(() => {
    const raw = sessionStorage.getItem('virtualrow:scene-telemetry');
    const events = raw ? (JSON.parse(raw) as Array<{ kind: string }>) : [];
    return events.filter((event) => event.kind === 'water-detection').length;
  });
  return row;
}

/** A context of its own, so the second row starts from empty storage. */
async function inFreshContext<T>(browser: Browser, parallelIndex: number, run: (page: Page) => Promise<T>) {
  const context = await browser.newContext({ baseURL: test.info().project.use.baseURL });
  try {
    const page = await context.newPage();
    let crashed = false;
    page.on('crash', () => {
      crashed = true;
    });
    await page.addInitScript((ports) => {
      (window as unknown as { __SIM_PORTS?: unknown }).__SIM_PORTS = ports;
    }, simPortsForWorker(parallelIndex));
    const result = await run(page);
    expect(crashed, 'the second row\'s renderer crashed').toBe(false);
    return result;
  } finally {
    await context.close();
  }
}

test.describe('a lake row with Overpass blocked (#493 AC8)', () => {
  test('finishes on the ribbon and saves the same bytes with lake outlines on or off', async ({ page, browser }, testInfo) => {
    // Two full rows of a 5 km course in one test: the comparison is the point.
    test.slow();

    const withOutlines = await rowTheLake(page, true);
    const withoutOutlines = await inFreshContext(browser, testInfo.parallelIndex, (fresh) => rowTheLake(fresh, false));

    for (const [label, row] of [['on', withOutlines], ['off', withoutOutlines]] as const) {
      expect(row.overpassResponses, `outlines ${label}: an Overpass response got through`).toBe(0);
      expect(row.elevationAttempts, `outlines ${label}: elevation was never asked`).toBeGreaterThan(0);
      // Fallback enrichment has no detection, so no lake outline to draw (FR10).
      expect(row.waterDetections, `outlines ${label}: detection ran on blocked data`).toBe(0);
      expect(row.ribbonHalfWidthM, `outlines ${label}: no water under the boat`).toBeGreaterThan(0);
    }
    // The same ribbon either way.
    expect(withOutlines.ribbonHalfWidthM).toBe(withoutOutlines.ribbonHalfWidthM);

    const sessions = JSON.parse(withOutlines.saved) as Array<{
      routeName: string;
      distance: number;
      duration: number;
      samples: unknown[];
    }>;
    expect(sessions, 'exactly one row was kept').toHaveLength(1);
    expect(sessions[0].routeName).toContain('Quinsig');
    // The whole course, at 4 m/s: over 5 km and over twenty minutes.
    expect(sessions[0].distance).toBeGreaterThan(5_000);
    expect(sessions[0].duration).toBeGreaterThan(1_200);
    expect(sessions[0].samples.length).toBeGreaterThan(100);

    // NFR5: byte for byte.
    expect(withOutlines.saved).toBe(withoutOutlines.saved);
  });
});
