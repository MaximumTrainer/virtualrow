import { test, expect, type Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mockBluetoothPath = path.resolve(__dirname, '../mock-bluetooth.js');
const sampleGeoJsonPath = path.resolve(__dirname, '../fixtures/rownative-sample-course.geojson');

async function waitForDeviceConnected(page: Page, deviceLabel: string) {
  await page.waitForFunction(
    (label) => {
      const containers = Array.from(document.querySelectorAll('.bluetooth-device-container'));
      const target = containers.find((c) =>
        c.querySelector('.device-name')?.textContent?.includes(label),
      );
      if (!target) return false;
      return target.querySelector('.device-status')?.textContent?.includes('Connected') ?? false;
    },
    deviceLabel,
    { timeout: 10_000 },
  );
}

test('imports sample GeoJSON route and renders it in 3D workout view without errors', async ({
  page,
}) => {
  const mockBluetoothScript = fs.readFileSync(mockBluetoothPath, 'utf8');
  await page.addInitScript({ content: mockBluetoothScript });

  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') {
      consoleErrors.push(message.text());
    }
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.goto('./');

  // Use DOM click here to avoid route-info-overlay backdrop-filter compositing layer
  // intercepting pointer events on macOS headless Chromium.
  await page.evaluate(() => {
    (document.querySelector('button.btn-import-route') as HTMLButtonElement)?.click();
  });
  await page.getByLabel('Route name').fill('Rownative Fixture Course');
  await page.locator('.route-import input[type="file"]').setInputFiles(sampleGeoJsonPath);

  const importedRouteCard = page.locator('.route-item', { hasText: 'Rownative Fixture Course' });
  await expect(importedRouteCard).toBeVisible({ timeout: 10_000 });
  await expect(importedRouteCard.locator('.route-item-thumbnail')).toBeVisible();

  await page.getByRole('button', { name: 'Connect PM5', exact: true }).click();
  await waitForDeviceConnected(page, 'Concept2 PM5');

  // Use DOM click here to avoid locator retries toggling Connect/Disconnect.
  await page.evaluate(() => {
    const containers = Array.from(document.querySelectorAll('.bluetooth-device-container'));
    const hrContainer = containers.find((c) =>
      c.querySelector('.device-name')?.textContent?.includes('Heart Rate Monitor'),
    );
    (hrContainer?.querySelector('button.btn-connect') as HTMLButtonElement)?.click();
  });
  await waitForDeviceConnected(page, 'Heart Rate Monitor');

  const startButton = page.locator('.btn-start-workout');
  await expect(startButton).toBeEnabled({ timeout: 10_000 });
  // Use DOM click here to avoid canvas pointer interception flaking locator.click().
  await page.evaluate(() => {
    (document.querySelector('.btn-start-workout') as HTMLButtonElement)?.click();
  });

  const canvasContainer = page.locator('.rower3d-canvas-container');
  await expect(canvasContainer).toBeVisible({ timeout: 15_000 });
  await expect(
    page.locator('.rower3d-canvas-container canvas:visible, .rower3d-fallback-marker:visible').first(),
  ).toBeVisible({ timeout: 15_000 });

  const fatalRuntimeErrors = [...pageErrors, ...consoleErrors].filter((text) =>
    /typeerror|referenceerror|cannot read properties of undefined/i.test(text),
  );
  expect(fatalRuntimeErrors).toEqual([]);
});
