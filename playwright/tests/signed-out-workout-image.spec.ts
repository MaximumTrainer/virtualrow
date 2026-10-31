import { test, expect, type Page, type Request } from '../fixtures/crash-watch';
import { expectSceneAlive } from '../utils/scene-health';

/**
 * #472 AC7 — a signed-out visitor sees the placeholder block panel over the
 * demo row, with no intervals.icu round-trip and nothing persisted.
 *
 * Pairs with `signed-out-test-drive.spec.ts` (#187): that one proves a guest
 * can row the demo without hardware; this one proves the Phase 2 auto-seed
 * put the "Sample workout" placeholder on the panel for them and the Phase 1
 * `source: 'manual'` flag kept the FR7 guest-save gate working.
 *
 * No `mock-bluetooth.js` is installed: the whole point is a visitor with no
 * harness affordances, so `window.__PLAYWRIGHT_TESTING` stays unset and the
 * real signed-out UI renders — the same discipline as `signed-out-test-drive`.
 */

const INTERVALS_ICU_HOST_PATTERN = /intervals\.icu/i;

/** Record every request that reached intervals.icu while a page was in use. */
function watchIntervalsRequests(page: Page): string[] {
  const hits: string[] = [];
  page.on('request', (req: Request) => {
    if (INTERVALS_ICU_HOST_PATTERN.test(req.url())) hits.push(req.url());
  });
  return hits;
}

async function endWorkout(page: Page) {
  await page.locator('.btn-end-workout').waitFor({ state: 'visible', timeout: 20_000 });
  await page.evaluate(() => (document.querySelector('.btn-end-workout') as HTMLButtonElement | null)?.click());
}

test.describe('signed-out demo workout image (#472)', () => {
  test('AC7: the home page tells the guest a sample workout is loaded', async ({ page }) => {
    const hits = watchIntervalsRequests(page);
    await page.goto('./');

    // The home page shows a loaded-workout indicator once the auto-seed fires
    // (FR3). The signed-in "Load today's workout" button only mounts for an
    // authenticated rower, so this indicator belongs to the Phase 2 placeholder.
    const loadedIndicator = page.locator('[data-testid="loaded-workout-name"]');
    await expect(loadedIndicator).toBeVisible();
    await expect(loadedIndicator).toContainText(/Sample workout/i);

    // NFR1 / AC7 — the auto-seed never calls out to intervals.icu.
    expect(hits).toEqual([]);
  });

  test('AC7: pressing Try Demo takes the guest to a row with the Sample workout panel visible', async ({ page }) => {
    const hits = watchIntervalsRequests(page);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('./');

    await page.locator('.btn-try-demo').click();

    // The activity view is up, with a live scene behind it (reused from the
    // existing signed-out-test-drive assertion).
    await expect(page.locator('.activity-view')).toBeVisible({ timeout: 20_000 });
    await expectSceneAlive(page, 'the sample-workout demo row');

    const panel = page.locator('.workout-block-panel');
    await expect(panel).toBeVisible();
    await expect(panel).toHaveClass(/workout-block-panel--demo/);
    await expect(panel.locator('[data-testid="workout-block-sample-prefix"]')).toHaveText(
      /Sample workout/i,
    );
    await expect(panel.locator('.workout-block-card--demo')).toBeVisible();

    // AC7 — no outbound to intervals.icu over the whole guest flow.
    expect(hits).toEqual([]);
  });

  test('AC7 / FR7: ending the guest row persists nothing to localStorage', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('./');

    await page.locator('.btn-try-demo').click();
    await expect(page.locator('.activity-view')).toBeVisible({ timeout: 20_000 });
    await expectSceneAlive(page, 'the sample-workout demo row');

    await endWorkout(page);
    await expect(page.locator('.guest-summary-modal')).toBeVisible({ timeout: 15_000 });

    const sessionKeys = await page.evaluate(() => {
      const keys: string[] = [];
      for (let i = 0; i < window.localStorage.length; i++) {
        const key = window.localStorage.key(i);
        if (key && key.startsWith('virtualrow:sessions:')) keys.push(key);
      }
      return keys;
    });
    expect(sessionKeys).toEqual([]);
  });
});
