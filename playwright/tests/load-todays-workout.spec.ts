/**
 * E2E for the Load-today's-workout entry point (issue #445, FR2 / AC2 /
 * AC10). The intervals.icu planned-events endpoint is stubbed at the
 * network layer so the test does not depend on a live account, and a mocked
 * signed-in athlete makes the button visible.
 */
import { test, expect, type Page } from '../fixtures/crash-watch';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mockBluetoothPath = path.resolve(__dirname, '../mock-bluetooth.js');

const TOKEN_URL = /\/oauth\/token/;
const EVENTS_URL = /\/api\/v1\/athlete\/[^/]+\/events\?/;

const todayIso = new Date().toISOString().slice(0, 10);

async function openApp(page: Page) {
  await page.addInitScript({ content: fs.readFileSync(mockBluetoothPath, 'utf8') });
  await page.addInitScript(() => {
    const athlete = { id: 'i12345', name: 'Test Athlete', email: 'a@example.com' };
    window.__AUTH_USER = athlete;
    sessionStorage.setItem('vr_auth_user', JSON.stringify(athlete));
    sessionStorage.setItem('vr_auth_refresh_token', 'e2e-refresh');
  });

  await page.route(TOKEN_URL, (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      access_token: 'e2e-access',
      expires_in: 3600,
      token_type: 'Bearer',
      athlete_id: 12345,
    }),
  }));

  await page.route(EVENTS_URL, (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify([
      {
        id: 'evt-1',
        workout_id: 'wo-1',
        start_date_local: `${todayIso}T07:00:00`,
        activity_type: 'row',
        name: "Today's Threshold Piece",
        workout_doc: {
          steps: [
            { type: 'warmup', duration: 300, description: 'Easy warmup' },
            { type: 'work', duration: 600, target_pace: 110, description: 'Threshold' },
            { type: 'cooldown', duration: 300, description: 'Cool down' },
          ],
        },
      },
    ]),
  }));

  await page.goto('./');
  await page.waitForSelector('.app-header', { timeout: 10_000 });
}

test.describe("Load today's workout (#445)", () => {
  test('signed-in athlete loads today\'s planned session and sees it named', async ({ page }) => {
    await openApp(page);

    const loadBtn = page.getByRole('button', { name: /load today's workout/i });
    await expect(loadBtn).toBeVisible({ timeout: 10_000 });
    await loadBtn.click();

    await expect(page.getByTestId('loaded-workout-name')).toContainText(
      "Today's Threshold Piece",
      { timeout: 10_000 },
    );
  });

  test('guest sees neither control (FR7 / D7(a))', async ({ page }) => {
    // No __AUTH_USER injected: __PLAYWRIGHT_TESTING still shows auth features
    // for other UI, but the LoadTodaysWorkoutButton is gated on a live user
    // and access token, not on that flag.
    await page.addInitScript({ content: fs.readFileSync(mockBluetoothPath, 'utf8') });
    await page.goto('./');
    await page.waitForSelector('.app-header', { timeout: 10_000 });

    await expect(page.getByRole('button', { name: /load today's workout/i })).toHaveCount(0);
  });
});
