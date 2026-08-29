import { test, expect, type Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mockBluetoothPath = path.resolve(__dirname, '../mock-bluetooth.js');

/** rownative course 1 as the public mirror actually serves it: two gate polygons, 5,306 m. */
const COURSE_1 = {
  id: '1',
  name: 'Quinsig South to North',
  country: 'United States',
  distance_m: 5306,
  status: 'established',
  polygons: [
    { order: 0, points: [{ lat: 42.24, lon: -71.81 }, { lat: 42.2401, lon: -71.8101 }] },
    { order: 1, points: [{ lat: 42.28766, lon: -71.81 }, { lat: 42.28776, lon: -71.8101 }] },
  ],
};

/** Serve the course mirror from the test rather than reaching the network. */
async function stubCourseMirror(page: Page) {
  await page.route('**/rownative/courses/**/1.json', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(COURSE_1) }),
  );
  await page.route('**/rownative/courses/**/404404.json', (route) =>
    route.fulfill({ status: 404, contentType: 'text/plain', body: 'not found' }),
  );
}

async function bootstrap(page: Page) {
  await page.addInitScript({ content: fs.readFileSync(mockBluetoothPath, 'utf8') });
  await stubCourseMirror(page);
}

test.describe('rownative.icu course handoff', () => {
  test('loads the selected course when returning with a valid state', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));
    page.on('pageerror', (e) => consoleErrors.push(e.message));

    await bootstrap(page);
    await page.goto('./');

    // Issue a nonce the way the outbound trip does, then return with it.
    const state = await page.evaluate(() => {
      const nonce = 'e2e-handoff-nonce';
      sessionStorage.setItem('vr_rownative_handoff', JSON.stringify({ state: nonce, issuedAt: Date.now() }));
      return nonce;
    });
    await page.goto(`./?rownativeCourseId=1&rownativeState=${state}`);

    // The course becomes the selected route.
    await expect(page.locator('.route-info-overlay h2')).toContainText('Quinsig South to North', { timeout: 15_000 });

    // Surveyed distance wins over anything derived from gate centroids.
    await expect(page.locator('.route-info-overlay')).toContainText('5.31 km');

    // Gate-only geometry is disclosed rather than passed off as a surveyed path.
    await expect(page.locator('.meta-badge--outline')).toBeVisible();

    // The handoff params are scrubbed so a refresh cannot replay the import.
    expect(new URL(page.url()).searchParams.get('rownativeCourseId')).toBeNull();
    expect(new URL(page.url()).searchParams.get('rownativeState')).toBeNull();

    expect(consoleErrors).toEqual([]);
  });

  test('refuses a forged link that carries no state', async ({ page }) => {
    await bootstrap(page);
    await page.goto('./?rownativeCourseId=1');

    await expect(page.locator('.rownative-handoff-banner--error')).toContainText(/expired/i, { timeout: 15_000 });
    await expect(page.locator('.route-info-overlay h2')).not.toContainText('Quinsig');
  });

  test('reports a course that does not exist', async ({ page }) => {
    await bootstrap(page);
    await page.goto('./');
    const state = await page.evaluate(() => {
      const nonce = 'e2e-missing-course';
      sessionStorage.setItem('vr_rownative_handoff', JSON.stringify({ state: nonce, issuedAt: Date.now() }));
      return nonce;
    });
    await page.goto(`./?rownativeCourseId=404404&rownativeState=${state}`);

    await expect(page.locator('.rownative-handoff-banner--error')).toContainText(/404/, { timeout: 15_000 });
  });

  test('a handed-off route renders in the 3D workout view', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (e) => pageErrors.push(e.message));

    await bootstrap(page);
    await page.goto('./');
    const state = await page.evaluate(() => {
      const nonce = 'e2e-3d-nonce';
      sessionStorage.setItem('vr_rownative_handoff', JSON.stringify({ state: nonce, issuedAt: Date.now() }));
      return nonce;
    });
    await page.goto(`./?rownativeCourseId=1&rownativeState=${state}`);
    await expect(page.locator('.route-info-overlay h2')).toContainText('Quinsig South to North', { timeout: 15_000 });

    // Start a session on the imported route via the workout service, as other specs do.
    await page.evaluate(() => {
      const svc = (window as unknown as { __workoutService?: { startSession?: (id: string, name: string) => unknown } }).__workoutService;
      svc?.startSession?.('handoff-course', 'Quinsig South to North');
    });

    await expect(page.locator('.activity-view')).toBeVisible({ timeout: 15_000 });
    // The 3D stage mounts without tripping the error boundary.
    await expect(page.locator('.activity-route-stage')).toBeVisible();
    await page.waitForTimeout(2_000);
    expect(pageErrors).toEqual([]);
  });
});
