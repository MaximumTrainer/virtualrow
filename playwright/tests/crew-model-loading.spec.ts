import { test, expect, type Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

/**
 * Issue #251 — the crewed sculls are published with the site and both of them
 * load.
 *
 * This spec exists because the app asked for its GLBs from the domain root
 * while the deploy publishes them under `--base=/virtualrow/app/`, so every
 * model 404'd in production. Nothing caught it: a failed useGLTF surfaces as a
 * fallback boat rather than an error, and dev and Playwright both serve from
 * `/`, where the broken form and the correct form coincide.
 *
 * So the assertions are about the network, not the picker. A spec that only
 * checked the radio group would have passed throughout the outage.
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
  await expect(page.locator('.rower3d-canvas-container')).toBeVisible({ timeout: 30_000 });
}

/** Every response the page received for a crewed scull, with its status. */
function recordCrewResponses(page: Page) {
  const seen: Array<{ url: string; status: number }> = [];
  page.on('response', (response) => {
    const url = response.url();
    if (/scull-(male|female)\.glb(\?|$)/.test(url)) {
      seen.push({ url, status: response.status() });
    }
  });
  return seen;
}

async function chooseCrew(page: Page, label: 'Male' | 'Female' | 'Auto') {
  await page.getByRole('radio', { name: label, exact: true }).click();
  await expect(page.getByRole('radio', { name: label, exact: true })).toHaveAttribute(
    'aria-checked',
    'true',
  );
}

test.describe('crewed sculls load for either rower (#251)', () => {
  test('both crew models are served, not 404, when the rower switches', async ({ page }) => {
    const responses = recordCrewResponses(page);
    const failures: string[] = [];
    page.on('requestfailed', (request) => {
      if (/scull-(male|female)\.glb/.test(request.url())) {
        failures.push(`${request.url()} ${request.failure()?.errorText ?? 'failed'}`);
      }
    });

    await page.addInitScript({ content: fs.readFileSync(mockBluetoothPath, 'utf8') });
    await page.goto('./');
    await connectHardwareAndStart(page);

    await chooseCrew(page, 'Female');
    await page.waitForTimeout(2_000);
    await chooseCrew(page, 'Male');
    await page.waitForTimeout(2_000);

    const female = responses.filter((r) => r.url.includes('scull-female.glb'));
    const male = responses.filter((r) => r.url.includes('scull-male.glb'));

    // Each crew must actually have been fetched...
    expect(female.length, 'the female scull was never requested').toBeGreaterThan(0);
    expect(male.length, 'the male scull was never requested').toBeGreaterThan(0);

    // ...and every fetch must have succeeded. This is the assertion that would
    // have failed throughout the production outage.
    expect(
      responses.filter((r) => r.status >= 400),
      'a crewed scull did not load',
    ).toEqual([]);
    expect(failures, 'a crewed scull request failed outright').toEqual([]);
  });

  test('the scene keeps drawing after the crew changes', async ({ page }) => {
    // A model that fails to load used to take the scene down with it; the point
    // of loading both is that the boat is still there afterwards.
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));

    await page.addInitScript({ content: fs.readFileSync(mockBluetoothPath, 'utf8') });
    await page.goto('./');
    await connectHardwareAndStart(page);

    await chooseCrew(page, 'Female');
    await page.waitForTimeout(2_000);

    await expect(page.locator('.rower3d-canvas-container canvas')).toBeVisible();
    const drew = await page.evaluate(() => window.__ROWER3D_RENDER_STATS?.drawCalls ?? null);
    if (drew !== null) expect(drew).toBeGreaterThan(0);

    expect(errors.filter((e) => /scull|glb|GLTF/i.test(e))).toEqual([]);
  });
});
