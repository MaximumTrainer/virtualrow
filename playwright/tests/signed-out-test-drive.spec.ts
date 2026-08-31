import { test, expect, type Page } from '@playwright/test';

/**
 * Issue #187 — a first-time visitor evaluating VirtualRow without an account.
 *
 * These specs deliberately do NOT install `mock-bluetooth.js`: the whole point
 * is a visitor with no rowing hardware and no test-harness affordances, so
 * `window.__PLAYWRIGHT_TESTING` stays unset and the real signed-out UI renders.
 */

/**
 * End the session via a DOM click.
 *
 * The WebGL canvas can intercept pointer events aimed at the controls below it
 * in headless Chromium. (The backdrop-filter compositing layers that used to
 * compound this are gone as of issue #219, R1; the canvas itself remains.)
 */
async function endWorkout(page: Page) {
  await page.locator('.btn-end-workout').waitFor({ state: 'visible', timeout: 20_000 });
  await page.evaluate(() => (document.querySelector('.btn-end-workout') as HTMLButtonElement | null)?.click());
}

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}

test.describe('signed-out test drive', () => {
  test('TD-1: the demo route is pre-selected and its map is drawn', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto('./');

    await expect(page.locator('.route-info-overlay h2')).toContainText('Willowbrook River');
    await expect(page.locator('.route-info-overlay .route-location')).toContainText('Willowbrook Valley');
    await expect(page.locator('.map-container canvas')).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('TD-1: the start control is disabled and names the missing device', async ({ page }) => {
    await page.goto('./');

    const start = page.locator('.btn-start-workout');
    await expect(start).toBeDisabled();
    await expect(start).toContainText(/Connect PM5 First/i);

    // Switching rower type changes which device the label names.
    await page.getByRole('button', { name: 'FTMS', exact: true }).click();
    await expect(start).toContainText(/Connect FTMS First/i);
  });

  test('TD-3: guest limits are stated in visible copy, and sign-in is above the fold', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('./');

    const notice = page.locator('.signed-out-notice');
    await expect(notice).toBeVisible();
    await expect(notice).toContainText(/sessions are not saved/i);

    // Reachable without scrolling on a 1280x800 viewport.
    const signIn = page.getByRole('button', { name: /sign in with intervals\.icu/i });
    await expect(signIn).toBeVisible();
    const box = await signIn.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.y + box!.height).toBeLessThanOrEqual(800);
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
  });

  test('TD-2: a visitor with no hardware can row a full demo session', async ({ page }) => {
    const errors = collectErrors(page);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('./');

    // No device was connected by hand — the demo control is the only interaction.
    await expect(page.locator('.bluetooth-device-container').first()).toContainText(/Disconnected/i);

    const demo = page.locator('.btn-try-demo');
    await expect(demo).toBeVisible();
    await expect(demo).toContainText(/no rowing machine needed/i);
    await demo.click();

    await expect(page.locator('.activity-view')).toBeVisible({ timeout: 20_000 });

    // TD-2.3 — the UI says the data is simulated.
    await expect(page.locator('.activity-demo-badge')).toContainText(/simulated data/i);

    // TD-2.2 — rower and heart-rate data stream without touching connection controls.
    const value = (label: string) =>
      page.locator('.activity-stat-card', { hasText: label }).locator('.activity-stat-value');
    await expect(value('SPM')).not.toContainText('--', { timeout: 20_000 });
    await expect(value('Power')).not.toContainText('--');
    await expect(value('Heart Rate')).not.toContainText('--');
    await expect(value('Split')).not.toContainText('--:--');

    // TD-1.4 / TD-3.3 — ending gives a summary naming what sign-in would have kept.
    await endWorkout(page);

    const summary = page.locator('.guest-summary-modal');
    await expect(summary).toBeVisible({ timeout: 15_000 });
    await expect(summary.locator('.guest-badge')).toContainText('Demo Row');
    await expect(summary.locator('.guest-summary-unsaved')).toContainText(/nothing has been saved/i);
    await expect(summary.locator('.guest-summary-unsaved')).toContainText(/distance, time, average pace, calories/i);
    await expect(summary.getByRole('button', { name: /row again/i })).toBeVisible();

    expect(errors).toEqual([]);
  });

  test('TD-1: Row Again returns to the routes view with nothing recorded', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('./');
    await page.locator('.btn-try-demo').click();
    await expect(page.locator('.activity-view')).toBeVisible({ timeout: 20_000 });

    await endWorkout(page);
    await page.getByRole('button', { name: /row again/i }).click();

    await expect(page.locator('.view-container--routes')).toBeVisible();
    // History was removed in #182; nothing anywhere records the session.
    await expect(page.getByRole('button', { name: /history/i })).toHaveCount(0);
  });

  test('TD-2: the demo control is offered outside the developer debug panel', async ({ page }) => {
    await page.goto('./');

    const demo = page.locator('.btn-try-demo');
    await expect(demo).toBeVisible();
    // The debug panel is closed, so anything inside it would be absent.
    await expect(page.locator('.debug-info-panel')).toHaveCount(0);
  });
});
