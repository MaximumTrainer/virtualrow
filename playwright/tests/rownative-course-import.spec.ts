import { test, expect, type Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mockBluetoothPath = path.resolve(__dirname, '../mock-bluetooth.js');

/** rownative course 5 as the mirror serves it: gate polygons, 5,349 m. */
const COURSE_5 = {
  id: '5',
  name: 'Quinsig S to N with gates',
  country: 'United States',
  distance_m: 5349,
  status: 'established',
  polygons: [
    { name: 'Start', order: 0, points: [{ lat: 42.246, lon: -71.746 }, { lat: 42.2461, lon: -71.7461 }] },
    { name: 'Finish', order: 1, points: [{ lat: 42.2941, lon: -71.746 }, { lat: 42.2942, lon: -71.7461 }] },
  ],
};

const INDEX = [
  { id: '5', name: 'Quinsig S to N with gates', country: 'United States', distance_m: 5349, status: 'established' },
  { id: '106', name: 'HOTS Stake Race', country: 'United States', distance_m: 4804, status: 'provisional' },
];

/**
 * Serve the GitHub mirror from the test. Any request to rownative.icu/api is
 * failed loudly so AC-6 (mirror only) is enforced rather than assumed.
 */
async function stubMirror(page: Page, apiCalls: string[]) {
  await page.route('**/rownative/courses/**/index.json', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(INDEX) }),
  );
  await page.route('**/rownative/courses/**/5.json', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(COURSE_5) }),
  );
  await page.route('**/rownative/courses/**/2.json', (route) =>
    route.fulfill({ status: 404, contentType: 'text/plain', body: 'not found' }),
  );
  await page.route('**/rownative.icu/api/**', (route) => {
    apiCalls.push(route.request().url());
    return route.abort();
  });
}

async function bootstrap(page: Page, apiCalls: string[]) {
  await page.addInitScript({ content: fs.readFileSync(mockBluetoothPath, 'utf8') });
  await stubMirror(page, apiCalls);
}

/**
 * Open the Routes screen and wait for the rownative import panel.
 *
 * The panel moved off the Row screen in issue #219 (R3) — course ID first, then
 * search by name.
 */
async function waitForPanel(page: Page) {
  await page.getByRole('button', { name: 'Routes', exact: true }).click();
  await page.getByLabel('Rownative course import').waitFor({ state: 'visible' });
}

test.describe('rownative.icu course import', () => {
  test('imports a pasted course id and shows rownative badges (AC-1, AC-6)', async ({ page }) => {
    const apiCalls: string[] = [];
    const consoleErrors: string[] = [];
    page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));
    page.on('pageerror', (e) => consoleErrors.push(e.message));

    await bootstrap(page, apiCalls);
    await page.goto('./');
    await waitForPanel(page);

    await page.getByLabel('Rownative course ID or link').fill('5');
    await page.getByRole('button', { name: /^Import$/ }).click();

    await expect(page.locator('.route-info-overlay h2')).toContainText('Quinsig S to N', { timeout: 15_000 });
    // The distance shown is measured from the geometry the boat rows (#194 R-5).
    await expect(page.locator('.route-info-overlay')).toContainText('5.35 km');
    // Gate-only geometry is disclosed rather than passed off as a surveyed path.
    await expect(page.locator('.meta-badge--outline')).toContainText('gates only');
    // rownative source + status badges on the route row, back on the Routes
    // screen — importing hands the user to the Row screen (issue #219, AC3.3).
    await page.getByRole('button', { name: 'Routes', exact: true }).click();
    await expect(page.locator('.route-item .badge-source')).toBeVisible();
    await expect(page.locator('.route-item .badge-status--established')).toBeVisible();

    expect(apiCalls).toEqual([]);
    expect(consoleErrors).toEqual([]);
  });

  test('imports a pasted rownative.icu course link (AC-1)', async ({ page }) => {
    const apiCalls: string[] = [];
    await bootstrap(page, apiCalls);
    await page.goto('./');
    await waitForPanel(page);

    await page.getByLabel('Rownative course ID or link').fill('https://rownative.icu/course/5');
    await page.getByRole('button', { name: /^Import$/ }).click();

    await expect(page.locator('.route-info-overlay h2')).toContainText('Quinsig S to N', { timeout: 15_000 });
    expect(apiCalls).toEqual([]);
  });

  test('rejects a foreign-host link without any network request (AC-4)', async ({ page }) => {
    const apiCalls: string[] = [];
    const courseRequests: string[] = [];
    await bootstrap(page, apiCalls);
    page.on('request', (r) => { if (r.url().includes('courses/')) courseRequests.push(r.url()); });

    await page.goto('./');
    await waitForPanel(page);
    await page.getByLabel('Rownative course ID or link').fill('https://evil.example/course/5');
    await page.getByRole('button', { name: /^Import$/ }).click();

    await expect(page.locator('.import-error')).toContainText(/rownative\.icu/i);
    expect(courseRequests).toEqual([]);
  });

  test('searches the catalogue by name and imports a result', async ({ page }) => {
    const apiCalls: string[] = [];
    await bootstrap(page, apiCalls);
    await page.goto('./');
    await waitForPanel(page);

    await page.getByLabel('Search rownative courses by name').fill('quinsig');
    await page.getByRole('button', { name: /^Search$/ }).click();

    await expect(page.locator('.rownative-result-name')).toContainText('Quinsig S to N', { timeout: 15_000 });
    await page.locator('.rownative-result').first().click();

    await expect(page.locator('.route-info-overlay h2')).toContainText('Quinsig S to N', { timeout: 15_000 });
    expect(apiCalls).toEqual([]);
  });

  test('explains an id missing from the mirror and offers search (AC-3)', async ({ page }) => {
    const apiCalls: string[] = [];
    await bootstrap(page, apiCalls);
    await page.goto('./');
    await waitForPanel(page);

    await page.getByLabel('Rownative course ID or link').fill('2');
    await page.getByRole('button', { name: /^Import$/ }).click();

    await expect(page.locator('.import-error')).toContainText(/isn't in the public mirror yet/i, { timeout: 15_000 });
    await page.getByRole('button', { name: /search by name/i }).click();
    await expect(page.locator('.rownative-result-name').first()).toBeVisible({ timeout: 15_000 });
  });

  test('deep link imports the course and cleans the URL (AC-2)', async ({ page }) => {
    const apiCalls: string[] = [];
    await bootstrap(page, apiCalls);

    await page.goto('./?rownativeCourseId=5');

    await expect(page.locator('.route-info-overlay h2')).toContainText('Quinsig S to N', { timeout: 15_000 });
    expect(new URL(page.url()).searchParams.get('rownativeCourseId')).toBeNull();
    expect(apiCalls).toEqual([]);
  });

  test('deep-linked route renders in the 3D workout view', async ({ page }) => {
    const apiCalls: string[] = [];
    const pageErrors: string[] = [];
    page.on('pageerror', (e) => pageErrors.push(e.message));

    await bootstrap(page, apiCalls);
    await page.goto('./?rownativeCourseId=5');
    await expect(page.locator('.route-info-overlay h2')).toContainText('Quinsig S to N', { timeout: 15_000 });

    await page.evaluate(() => {
      const svc = (window as unknown as { __workoutService?: { startSession?: (id: string, name: string) => unknown } }).__workoutService;
      svc?.startSession?.('rownative-5', 'Quinsig S to N with gates');
    });

    await expect(page.locator('.activity-view')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('.activity-route-stage')).toBeVisible();
    await page.waitForTimeout(2_000);
    expect(pageErrors).toEqual([]);
  });
});
