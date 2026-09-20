import { test, expect, type Page } from '../fixtures/crash-watch';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

/**
 * Attaching a track, the way a rower does it (#313).
 *
 * `rownative-track-geometry.spec.ts` proves what an attached track does to a
 * course's shape, length and badge — but it puts the attachment there itself,
 * with an init script that writes straight into localStorage and a comment
 * saying it was "seeded the way a previous session would have left it". No
 * session could: nothing under src/components imported trackAttachmentStore,
 * so the flow #206 reported as shipped had no entrance at all.
 *
 * This spec is the entrance. It picks a real GPX file through a real file
 * input and asserts on what the page then says, so the claim "a rower can
 * attach their own track" is tested rather than assumed.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtureDir = path.resolve(__dirname, '../../src/__tests__/fixtures/rownative');
const mockBluetoothPath = path.resolve(__dirname, '../mock-bluetooth.js');

/** Course 179 exactly as the mirror serves it: two gates, 19,599 m apart. */
const COURSE_179 = fs.readFileSync(path.join(fixtureDir, '179.json'), 'utf8');

/** The Clyde track that belongs to it. */
const TRACK_179 = path.join(fixtureDir, '179.gpx');

const TRACK_STORAGE_KEY = 'virtualrow.rownative.tracks.v1';

const INDEX = JSON.stringify([
  { id: '179', name: 'Castle to Crane', country: 'Scotland', distance_m: 19_599, status: 'established' },
]);

async function stubMirror(page: Page) {
  // The BLE harness, which is also what puts the app into test mode and gets it
  // past the setup screen to Routes. Every rownative spec starts this way.
  await page.addInitScript({ content: fs.readFileSync(mockBluetoothPath, 'utf8') });

  await page.route('**/rownative/courses/**/index.json', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: INDEX }),
  );
  await page.route('**/rownative/courses/**/179.json', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: COURSE_179 }),
  );
}

/** Open Routes, search, and get the course row with its attach control. */
async function showCourse(page: Page) {
  await page.getByRole('button', { name: 'Routes', exact: true }).click();
  await page.getByLabel('Rownative course import').waitFor({ state: 'visible' });
  await page.getByRole('button', { name: /^Search$/ }).click();
  await expect(page.getByText(/showing 1 of 1 courses/i)).toBeVisible({ timeout: 15_000 });
}

const storedTrack = (page: Page) =>
  page.evaluate((key) => {
    try {
      const raw = window.localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as Record<string, { fileName: string; coordinates: unknown[] }>) : null;
    } catch {
      return null;
    }
  }, TRACK_STORAGE_KEY);

test.describe('attaching a track to a rownative course', () => {
  test('a rower can attach their own GPX and the course takes its shape', async ({ page }) => {
    await stubMirror(page);
    await page.goto('./');
    await showCourse(page);

    // Nothing attached to begin with, and the control says so.
    expect(await storedTrack(page)).toBeNull();
    await expect(page.getByText('Attach track')).toBeVisible();

    await page
      .getByLabel('Attach a track to Castle to Crane')
      .setInputFiles(TRACK_179);

    // Attaching imports the course, which takes the rower to it — the same
    // thing the Import button does, and the reason there is no status message
    // left to read: the panel has gone.
    await expect(page.locator('.route-info-overlay h2')).toContainText('Castle to Crane', {
      timeout: 20_000,
    });

    // The course now has the river's shape rather than a straight line, which
    // is the whole point of attaching. The same numbers #206 documents.
    const selected = await page.evaluate(() => window.__SELECTED_ROUTE);
    expect(selected?.geometrySource, 'the attached track was not used').toBe('track');
    expect(selected!.distanceKm).toBeGreaterThan(20);
    expect(selected!.distanceKm).toBeLessThan(23);
    await expect(page.locator('.meta-badge--outline'), 'still labelled gates-only').toHaveCount(0);

    // And it is really stored, with the fitted line rather than an empty shell.
    const stored = await storedTrack(page);
    expect(stored, 'nothing reached storage').not.toBeNull();
    expect(stored!['179'].fileName).toBe('179.gpx');
    expect(stored!['179'].coordinates.length).toBeGreaterThan(10);
  });

  test('a track for the wrong water is refused, and says which gate it missed', async ({ page }) => {
    await stubMirror(page);
    await page.goto('./');
    await showCourse(page);

    // The Thames, several hundred kilometres from either Clyde gate.
    const wrongWater = {
      name: 'thames.geojson',
      mimeType: 'application/geo+json',
      buffer: Buffer.from(
        JSON.stringify({
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'LineString',
            coordinates: [[-0.24, 51.47], [-0.22, 51.48], [-0.2, 51.49]],
          },
        }),
      ),
    };

    await page.getByLabel('Attach a track to Castle to Crane').setInputFiles(wrongWater);

    const alert = page.getByRole('alert');
    await expect(alert).toBeVisible({ timeout: 20_000 });
    // The gate check's own words, naming the gate and the distance.
    await expect(alert).toContainText(/gate/i);

    // And nothing was stored, so a bad file cannot break a good course.
    expect(await storedTrack(page), 'a refused track was stored anyway').toBeNull();
  });

  test('a file that is not a track at all is refused by name', async ({ page }) => {
    await stubMirror(page);
    await page.goto('./');
    await showCourse(page);

    await page.getByLabel('Attach a track to Castle to Crane').setInputFiles({
      name: 'holiday.png',
      mimeType: 'image/png',
      buffer: Buffer.from('not a track'),
    });

    await expect(page.getByRole('alert')).toContainText(/\.gpx, \.kml or \.geojson/i, {
      timeout: 20_000,
    });
    expect(await storedTrack(page)).toBeNull();
  });

  test('an attached track can be removed again', async ({ page }) => {
    await stubMirror(page);
    await page.goto('./');
    await showCourse(page);

    await page.getByLabel('Attach a track to Castle to Crane').setInputFiles(TRACK_179);
    await expect(page.locator('.route-info-overlay h2')).toContainText('Castle to Crane', {
      timeout: 20_000,
    });

    // Back to the panel, which now shows what is attached and offers to remove it.
    await showCourse(page);
    await expect(page.getByText('179.gpx')).toBeVisible();

    await page
      .getByRole('button', { name: /Remove the track attached to Castle to Crane/i })
      .click();

    // Removing re-imports the course too, so the rower sees the result.
    await expect(page.locator('.route-info-overlay h2')).toContainText('Castle to Crane', {
      timeout: 20_000,
    });
    const selected = await page.evaluate(() => window.__SELECTED_ROUTE);
    expect(selected?.geometrySource, 'the removed track was still in use').toBe('gate-chain');

    const stored = await storedTrack(page);
    expect(stored?.['179'], 'the attachment outlived its removal').toBeUndefined();
  });

  test('an attached track survives a reload, because a session really left it', async ({ page }) => {
    await stubMirror(page);
    await page.goto('./');
    await showCourse(page);

    await page.getByLabel('Attach a track to Castle to Crane').setInputFiles(TRACK_179);
    await expect(page.locator('.route-info-overlay h2')).toContainText('Castle to Crane', {
      timeout: 20_000,
    });

    await page.reload();
    await showCourse(page);

    // This is the claim rownative-track-geometry.spec.ts had to fake.
    await expect(page.getByText('179.gpx')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('Replace track')).toBeVisible();
  });
});
