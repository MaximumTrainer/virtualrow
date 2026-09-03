import { test, expect, type Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

/**
 * Issue #67 — following a structured workout on a route.
 *
 * The segment model, progression and compliance are unit-tested against the
 * service and the hook. What this spec covers is the part only a browser can
 * answer: that the library, the selection, the start flow and the in-session
 * overlay are actually wired to each other, and that a row with no workout
 * selected is unchanged.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mockBluetoothPath = path.resolve(__dirname, '../mock-bluetooth.js');

async function waitForDeviceConnected(page: Page, deviceLabel: string) {
  await page.waitForFunction(
    (label) => {
      const containers = Array.from(document.querySelectorAll('.bluetooth-device-container'));
      const target = containers.find((c) =>
        c.querySelector('.device-name')?.textContent?.includes(label),
      );
      return target?.querySelector('.device-status')?.textContent?.includes('Connected') ?? false;
    },
    deviceLabel,
    { timeout: 10_000 },
  );
}

async function connectHardwareAndStart(page: Page) {
  await page.getByRole('button', { name: 'Connect PM5', exact: true }).click();
  await waitForDeviceConnected(page, 'Concept2 PM5');
  await page.evaluate(() => {
    const containers = Array.from(document.querySelectorAll('.bluetooth-device-container'));
    const hr = containers.find((c) =>
      c.querySelector('.device-name')?.textContent?.includes('Heart Rate Monitor'),
    );
    (hr?.querySelector('button.btn-connect') as HTMLButtonElement)?.click();
  });
  await waitForDeviceConnected(page, 'Heart Rate Monitor');

  await expect(page.locator('.btn-start-workout')).toBeEnabled({ timeout: 10_000 });
  await page.evaluate(() => {
    (document.querySelector('.btn-start-workout') as HTMLButtonElement)?.click();
  });
}

async function openApp(page: Page) {
  await page.addInitScript({ content: fs.readFileSync(mockBluetoothPath, 'utf8') });
  await page.goto('./');
}

test('the workouts tab lists the library and remembers what was chosen', async ({ page }) => {
  await openApp(page);

  await page.getByRole('button', { name: 'Workouts', exact: true }).click();
  const cards = page.locator('.workout-card');
  await expect(cards.first()).toBeVisible();

  const count = await cards.count();
  expect(count).toBeGreaterThan(0);

  // Each card says what it will ask of the rower.
  await expect(cards.first()).toContainText(/segment/i);

  await cards.first().getByRole('button', { name: /use this workout/i }).click();
  await expect(cards.first()).toHaveAttribute('aria-current', 'true');

  // The choice survives a reload — it is what the next row will follow.
  await page.reload();
  await page.getByRole('button', { name: 'Workouts', exact: true }).click();
  await expect(page.locator('.workout-card').first()).toHaveAttribute('aria-current', 'true');
});

test('a selected workout runs over the row, with targets and a timeline', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await openApp(page);

  await page.getByRole('button', { name: 'Workouts', exact: true }).click();
  const card = page.locator('.workout-card').first();
  const workoutName = (await card.locator('.workout-card-name').textContent())?.trim();
  await card.getByRole('button', { name: /use this workout/i }).click();
  await page.getByRole('button', { name: /back to row/i }).click();

  await connectHardwareAndStart(page);

  const overlay = page.locator('.workout-overlay');
  await expect(overlay).toBeVisible({ timeout: 30_000 });
  await expect(overlay).toContainText(workoutName!);

  // Both progress bars, the segment's targets and the full timeline.
  await expect(overlay.getByRole('progressbar', { name: /overall/i })).toBeVisible();
  await expect(overlay.getByRole('progressbar', { name: /segment/i })).toBeVisible();
  await expect(overlay.locator('.workout-segment-target')).not.toBeEmpty();

  const steps = overlay.getByRole('list', { name: /timeline/i }).getByRole('listitem');
  await expect(steps.first()).toBeVisible();
  expect(await steps.count()).toBeGreaterThan(0);

  // The compliance light says one of the states it is allowed to say.
  const compliance = await overlay.locator('.workout-compliance').getAttribute('data-compliance');
  expect(['untargeted', 'on-target', 'too-fast', 'too-slow', 'off-target']).toContain(compliance);

  expect(
    errors.filter((text) => /typeerror|referenceerror|cannot read properties/i.test(text)),
  ).toEqual([]);
});

test('a row with no workout selected is exactly as it was', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await openApp(page);

  // Make sure nothing is selected, then row.
  await page.getByRole('button', { name: 'Workouts', exact: true }).click();
  const selected = page.locator('.workout-card[aria-current="true"]');
  if ((await selected.count()) > 0) {
    await selected.getByRole('button', { name: /free row/i }).click();
  }
  await page.getByRole('button', { name: /back to row/i }).click();

  await connectHardwareAndStart(page);

  await expect(page.locator('.rower3d-canvas-container')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('.workout-overlay')).toHaveCount(0);

  expect(
    errors.filter((text) => /typeerror|referenceerror|cannot read properties/i.test(text)),
  ).toEqual([]);
});

test('an intervals.icu import reports a bad credential rather than failing silently', async ({
  page,
}) => {
  await openApp(page);
  await page.route('**/intervals.icu/**', (route) =>
    route.fulfill({ status: 401, body: 'Unauthorized' }),
  );

  await page.getByRole('button', { name: 'Workouts', exact: true }).click();

  await page.getByLabel(/api key/i).fill('not-a-real-key');
  await page.getByLabel(/athlete id/i).fill('i00000');
  await page.getByLabel(/workout id/i).fill('123');

  const importButton = page.getByRole('button', { name: /^import$/i });
  await expect(importButton).toBeEnabled();
  await importButton.click();

  // Whatever the failure, the rower is told and the app stays usable.
  await expect(page.locator('.workout-import-error')).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('.workout-card').first()).toBeVisible();
});

test('the import button stays disabled until every detail is given', async ({ page }) => {
  await openApp(page);
  await page.getByRole('button', { name: 'Workouts', exact: true }).click();

  const importButton = page.getByRole('button', { name: /^import$/i });
  await expect(importButton).toBeDisabled();

  await page.getByLabel(/api key/i).fill('key');
  await expect(importButton).toBeDisabled();

  await page.getByLabel(/athlete id/i).fill('i1');
  await expect(importButton).toBeDisabled();

  await page.getByLabel(/workout id/i).fill('9');
  await expect(importButton).toBeEnabled();
});
