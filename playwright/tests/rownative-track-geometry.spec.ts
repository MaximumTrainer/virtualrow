import { test, expect, type Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mockBluetoothPath = path.resolve(__dirname, '../mock-bluetooth.js');
const fixtureDir = path.resolve(__dirname, '../../src/__tests__/fixtures/rownative');

/** rownative course 179 exactly as the mirror serves it: two gates, 19,599 m. */
const COURSE_179 = fs.readFileSync(path.join(fixtureDir, '179.json'), 'utf8');

/** The Clyde track shipped alongside it, read straight out of the GPX. */
function castleToCraneTrack(): { lat: number; lng: number }[] {
  const gpx = fs.readFileSync(path.join(fixtureDir, '179.gpx'), 'utf8');
  return [...gpx.matchAll(/<trkpt\s+lat="([-\d.]+)"\s+lon="([-\d.]+)"/g)]
    .map((match) => ({ lat: Number(match[1]), lng: Number(match[2]) }));
}

const TRACK_STORAGE_KEY = 'virtualrow.rownative.tracks.v1';

async function bootstrap(page: Page, options: { attachTrack: boolean }) {
  await page.addInitScript({ content: fs.readFileSync(mockBluetoothPath, 'utf8') });

  if (options.attachTrack) {
    // Seeded the way a previous session would have left it, so this also covers
    // "the attachment survives a reload" (AC-11).
    await page.addInitScript(
      ([key, value]) => window.localStorage.setItem(key, value),
      [TRACK_STORAGE_KEY, JSON.stringify({
        179: { courseId: '179', fileName: '179.gpx', attachedAt: 1, coordinates: castleToCraneTrack() },
      })] as const,
    );
  }

  await page.route('**/rownative/courses/**/179.json', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: COURSE_179 }),
  );
}

async function connectDevice(page: Page, label: string) {
  await page.evaluate((deviceLabel) => {
    const containers = Array.from(document.querySelectorAll('.bluetooth-device-container'));
    const target = containers.find((c) => c.querySelector('.device-name')?.textContent?.includes(deviceLabel));
    (target?.querySelector('button.btn-connect') as HTMLButtonElement)?.click();
  }, label);
  await page.waitForFunction((deviceLabel) => {
    const containers = Array.from(document.querySelectorAll('.bluetooth-device-container'));
    const target = containers.find((c) => c.querySelector('.device-name')?.textContent?.includes(deviceLabel));
    return target?.querySelector('.device-status')?.textContent?.includes('Connected') ?? false;
  }, label, { timeout: 15_000 });
}

test.describe('rownative course geometry (issue #194)', () => {
  test('a gates-only course says so and reports its straight-line length', async ({ page }) => {
    await bootstrap(page, { attachTrack: false });
    await page.goto('./?rownativeCourseId=179');

    await expect(page.locator('.route-info-overlay h2')).toContainText('Castle to Crane', { timeout: 15_000 });
    await expect(page.locator('.meta-badge--outline')).toContainText('gates only');

    const selected = await page.evaluate(() => window.__SELECTED_ROUTE);
    expect(selected?.geometrySource).toBe('gate-chain');
    // The gate chain and rownative's own figure agree, so no second number.
    await expect(page.locator('.meta-badge--external-distance')).toHaveCount(0);
  });

  test('an attached track gives the course its real shape, length and badge', async ({ page }) => {
    await bootstrap(page, { attachTrack: true });
    await page.goto('./?rownativeCourseId=179');

    await expect(page.locator('.route-info-overlay h2')).toContainText('Castle to Crane', { timeout: 15_000 });

    const selected = await page.evaluate(() => window.__SELECTED_ROUTE);
    expect(selected?.geometrySource).toBe('track');
    // ~13 miles of river, not the 19.6 km straight line down the Clyde.
    expect(selected!.distanceKm).toBeGreaterThan(20);
    expect(selected!.distanceKm).toBeLessThan(23);
    expect(selected!.externalDistanceMeters).toBe(19599);

    // No gates-only chip, and both figures shown because they disagree.
    await expect(page.locator('.meta-badge--outline')).toHaveCount(0);
    await expect(page.locator('.meta-badge--external-distance')).toContainText('rownative lists 19.60 km');
  });

  test('the card and the boat row the same distance (AC-7)', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    await bootstrap(page, { attachTrack: true });
    await page.goto('./?rownativeCourseId=179');
    await expect(page.locator('.route-info-overlay h2')).toContainText('Castle to Crane', { timeout: 15_000 });

    await connectDevice(page, 'Concept2 PM5');
    await connectDevice(page, 'Heart Rate Monitor');

    await expect(page.locator('.btn-start-workout')).toBeEnabled({ timeout: 15_000 });
    await page.evaluate(() => (document.querySelector('.btn-start-workout') as HTMLButtonElement)?.click());
    await expect(page.locator('.rower3d-canvas-container')).toBeVisible({ timeout: 20_000 });

    await page.waitForFunction(() => (window.__ROWER3D_ROUTE?.totalDistance ?? 0) > 0, { timeout: 20_000 });
    const { engineTotal, cardKm } = await page.evaluate(() => ({
      engineTotal: window.__ROWER3D_ROUTE!.totalDistance,
      cardKm: window.__SELECTED_ROUTE!.distanceKm,
    }));

    // The number on the card and the number the engine rows to are the same,
    // to the metre, on a 22 km course.
    expect(Math.abs(engineTotal - cardKm * 1000)).toBeLessThan(1);
    expect(pageErrors).toEqual([]);

    // The other half of AC-7 — rowing that distance lands the boat at
    // progress 1.0 — is covered in rownativeGeometry.test.ts against the same
    // curve code. It cannot be driven from here: BluetoothDevice is the only
    // subscriber to the PM5 data stream and it renders only on the routes
    // view, so no rower data reaches the app once a workout starts. That is a
    // pre-existing defect, unrelated to course geometry.
  });
});
