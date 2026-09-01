import { test, expect, type Page, type Route } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';
import { fileURLToPath } from 'url';

/**
 * Issue #221 — a signed-in athlete finishes a row and saves it to intervals.icu.
 *
 * The upload endpoint is stubbed at the network layer (AC3.8), the way
 * `rownative-course-import.spec.ts` stubs the courses mirror: nothing here
 * reaches intervals.icu or the real CORS proxy.
 *
 * A *real* row (mocked PM5 + heart-rate strap) is what carries the Save
 * control; the demo row is used only to prove it does not (AC5.2).
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mockBluetoothPath = path.resolve(__dirname, '../mock-bluetooth.js');

const UPLOAD_URL = '**/proxy/api/v1/athlete/0/activities**';

/** What the stub saw, so the request can be asserted without a real endpoint. */
interface CapturedUpload {
  url: string;
  method: string;
  bodyLength: number;
}

function stubUpload(page: Page, respond: (route: Route) => Promise<void>): CapturedUpload[] {
  const captured: CapturedUpload[] = [];
  page.route(UPLOAD_URL, async (route) => {
    captured.push({
      url: route.request().url(),
      method: route.request().method(),
      bodyLength: (route.request().postData() ?? '').length,
    });
    await respond(route);
  });
  return captured;
}

const created = (route: Route) => route.fulfill({
  status: 200,
  contentType: 'application/json',
  body: JSON.stringify({ id: 'i99887766' }),
});

const TOKEN_URL = '**/proxy/api/oauth/token**';

/**
 * Load the app with mocked Bluetooth and a signed-in athlete.
 *
 * `mock-bluetooth.js` sets `__PLAYWRIGHT_TESTING`, which is what makes the app
 * treat the row as a signed-in one rather than a guest's.
 *
 * Signing in without an OAuth round-trip: `AuthService` revives its user from
 * sessionStorage on construction and then silently refreshes, because the
 * access token is deliberately never persisted. Seeding the user and a refresh
 * token and stubbing the token endpoint gives the app a real access token
 * through its own code path — no test-only hook in the service.
 */
async function openApp(page: Page) {
  await page.addInitScript({ content: fs.readFileSync(mockBluetoothPath, 'utf8') });
  await page.addInitScript(() => {
    const athlete = { id: 'i12345', name: 'Test Athlete', email: 'athlete@example.com' };
    window.__AUTH_USER = athlete;
    sessionStorage.setItem('vr_auth_user', JSON.stringify(athlete));
    sessionStorage.setItem('vr_auth_refresh_token', 'e2e-refresh-token');
  });

  const tokenIssued = page.waitForResponse(TOKEN_URL, { timeout: 30_000 });
  await page.route(TOKEN_URL, (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      access_token: 'e2e-access-token',
      expires_in: 3600,
      token_type: 'Bearer',
      athlete_id: 12345,
    }),
  }));

  await page.goto('./');
  await tokenIssued;
}

/** Connect the mocked PM5 and heart-rate strap. */
async function connectDevices(page: Page) {
  await page.click('button:has-text("Connect PM5")');
  await page.waitForFunction(() => {
    const names = Array.from(document.querySelectorAll('.device-name'));
    const pm5 = names.find((n) => String(n.textContent).includes('Concept2 PM5'));
    const status = pm5?.closest('.bluetooth-device-container')?.querySelector('.device-status');
    return !!status && String(status.textContent).includes('Connected');
  }, { timeout: 20_000 });

  await page.click('button:has-text("Connect HR Monitor")');
  await page.waitForFunction(() => {
    const containers = Array.from(document.querySelectorAll('.bluetooth-device-container'));
    const hr = containers.find((c) => String(c.querySelector('.device-name')?.textContent).includes('Heart Rate Monitor'));
    const status = hr?.querySelector('.device-status');
    return !!status && String(status.textContent).includes('Connected');
  }, { timeout: 20_000 });
}

/** PM5 general status: elapsed time (24-bit LE, x0.01s) then distance (24-bit LE, x0.1m). */
function dispatchGeneralStatus(page: Page, distanceMeters: number, elapsedSeconds: number) {
  return page.evaluate(({ distanceMeters, elapsedSeconds }) => {
    const buf = new ArrayBuffer(11);
    const v = new Uint8Array(buf);
    const cs = Math.round(elapsedSeconds * 100);
    v[0] = cs & 0xff; v[1] = (cs >> 8) & 0xff; v[2] = (cs >> 16) & 0xff;
    const dm = Math.round(distanceMeters * 10);
    v[3] = dm & 0xff; v[4] = (dm >> 8) & 0xff; v[5] = (dm >> 16) & 0xff;
    v[10] = 2; // strokeState = rowing
    (window as unknown as { __pm5CharGeneral?: { _dispatch: (v: DataView) => void } })
      .__pm5CharGeneral?._dispatch(new DataView(buf));
  }, { distanceMeters, elapsedSeconds });
}

/** PM5 additional status: speed, stroke rate, heart rate, current and average pace. */
function dispatchAdditionalStatus(
  page: Page,
  { elapsedSeconds, strokeRate, heartRate }: { elapsedSeconds: number; strokeRate: number; heartRate: number },
) {
  return page.evaluate(({ elapsedSeconds, strokeRate, heartRate }) => {
    const buf = new ArrayBuffer(11);
    const v = new Uint8Array(buf);
    const cs = Math.round(elapsedSeconds * 100);
    v[0] = cs & 0xff; v[1] = (cs >> 8) & 0xff; v[2] = (cs >> 16) & 0xff;
    v[3] = 0xd0; v[4] = 0x07;   // speed 2.000 m/s
    v[5] = strokeRate;
    v[6] = heartRate;
    v[7] = 0x1c; v[8] = 0x2e;   // currentPace 118.04 s/500m
    v[9] = 0x1c; v[10] = 0x2e;  // averagePace
    (window as unknown as { __pm5CharAdditional?: { _dispatch: (v: DataView) => void } })
      .__pm5CharAdditional?._dispatch(new DataView(buf));
  }, { elapsedSeconds, strokeRate, heartRate });
}

/**
 * Row `seconds` at 4 m/s, feeding the PM5 characteristics once a second so the
 * 1 Hz sampler has a series to work from, then end the session.
 */
async function rowAndEnd(page: Page, seconds = 8) {
  await page.locator('.btn-start-workout').click();
  await expect(page.locator('.activity-view')).toBeVisible({ timeout: 25_000 });

  for (let t = 0; t <= seconds; t++) {
    await dispatchGeneralStatus(page, t * 4, t);
    await dispatchAdditionalStatus(page, { elapsedSeconds: t, strokeRate: 24, heartRate: 132 });
    await page.waitForTimeout(60);
  }

  await page.locator('.btn-end-workout').waitFor({ state: 'visible', timeout: 20_000 });
  await page.evaluate(() => (document.querySelector('.btn-end-workout') as HTMLButtonElement | null)?.click());
  await expect(page.locator('.session-summary-modal')).toBeVisible({ timeout: 20_000 });
}

test.describe('activity upload to intervals.icu (issue #221)', () => {
  test('AC1.1/AC4.1: the row is sampled at 1 Hz and reported in the summary', async ({ page }) => {
    await openApp(page);
    await connectDevices(page);
    await rowAndEnd(page);

    const summary = page.locator('.session-summary-modal');
    await expect(summary.getByRole('heading', { name: /workout complete/i })).toBeVisible();
    await expect(summary).toContainText('Willowbrook River');
    await expect(summary.locator('.session-stat')).not.toHaveCount(0);

    const sampleCount = await page.evaluate(
      () => window.__workoutService!.getAllSessions().at(-1)!.samples.length,
    );
    // Nine elapsed seconds were fed in, so nine samples — one per second, no more.
    expect(sampleCount).toBe(9);
  });

  test('AC3.1/AC3.2/AC4.3: Save posts multipart to athlete 0 and links to the activity', async ({ page }) => {
    await openApp(page);
    const captured = stubUpload(page, created);
    await connectDevices(page);
    await rowAndEnd(page);

    const save = page.locator('.btn-session-save');
    await expect(save).toBeEnabled();
    await page.evaluate(() => (document.querySelector('.btn-session-save') as HTMLButtonElement | null)?.click());

    // AC4.3 — success turns the control into a link to the activity.
    const link = page.locator('.session-summary-saved a');
    await expect(link).toBeVisible({ timeout: 20_000 });
    await expect(link).toHaveAttribute('href', 'https://intervals.icu/activities/i99887766');
    await expect(page.locator('.btn-session-save')).toHaveCount(0);

    expect(captured).toHaveLength(1);
    expect(captured[0].method).toBe('POST');
    expect(captured[0].bodyLength).toBeGreaterThan(0);
    expect(captured[0].url).toContain('/proxy/api/v1/athlete/0/activities');
    expect(captured[0].url).toContain('external_id=virtualrow-');
  });

  test('AC3.5/AC3.6: a rejected upload names the status and stays retryable', async ({ page }) => {
    await openApp(page);
    let attempts = 0;
    stubUpload(page, async (route) => {
      attempts += 1;
      if (attempts === 1) {
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Server exploded' }),
        });
        return;
      }
      await created(route);
    });
    await connectDevices(page);
    await rowAndEnd(page);

    await page.evaluate(() => (document.querySelector('.btn-session-save') as HTMLButtonElement | null)?.click());

    const error = page.locator('.session-summary-error');
    await expect(error).toBeVisible({ timeout: 20_000 });
    await expect(error).toContainText('500');
    await expect(error).toContainText('Server exploded');

    // AC3.6 — the row survives and the button can be pressed again.
    await expect(page.locator('.btn-session-save')).toBeEnabled();
    await page.evaluate(() => (document.querySelector('.btn-session-save') as HTMLButtonElement | null)?.click());
    await expect(page.locator('.session-summary-saved a')).toBeVisible({ timeout: 20_000 });
  });

  test('AC4.5/AC6.1: Done returns to the Row screen and the row is kept locally', async ({ page }) => {
    await openApp(page);
    await connectDevices(page);
    await rowAndEnd(page);

    await page.evaluate(() => (document.querySelector('.btn-session-done') as HTMLButtonElement | null)?.click());
    await expect(page.locator('.session-summary-modal')).toHaveCount(0);
    await expect(page.locator('.view-container--routes')).toBeVisible();

    const stored = await page.evaluate(
      () => JSON.parse(localStorage.getItem('virtualrow:sessions:i12345') ?? '[]').length,
    );
    expect(stored).toBeGreaterThan(0);
  });

  test('AC5.2/AC5.3: a demo row is never uploadable, even signed in', async ({ page }) => {
    await openApp(page);
    const captured = stubUpload(page, created);

    await page.locator('.btn-try-demo').click();
    await expect(page.locator('.activity-view')).toBeVisible({ timeout: 25_000 });
    await page.waitForTimeout(3_000);
    await page.evaluate(() => (document.querySelector('.btn-end-workout') as HTMLButtonElement | null)?.click());

    const summary = page.locator('.session-summary-modal');
    await expect(summary).toBeVisible({ timeout: 20_000 });
    // AC5.3 — the badge and the download are there, so the engine is inspectable.
    await expect(summary.locator('.session-summary-badge')).toContainText(/demo row/i);
    await expect(summary.locator('.btn-session-download')).toBeVisible();
    // AC5.2 — but nothing simulated may enter a real training log.
    await expect(summary.locator('.btn-session-save')).toHaveCount(0);
    expect(captured).toEqual([]);

    // AC6.4 — nor is a demo row kept locally.
    const stored = await page.evaluate(
      () => JSON.parse(localStorage.getItem('virtualrow:sessions:i12345') ?? '[]').length,
    );
    expect(stored).toBe(0);
  });
});
