import { test, expect, type Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { expectSceneAlive } from '../utils/scene-health';

/**
 * Issue #269 — the ground either side of the waterway must look different from
 * the water.
 *
 * It did not, because there was no water: the channel used a MeshPhysicalMaterial
 * whose realism came from `transmission`, which needs a scene behind the surface
 * to refract and had none. A probe material on the same geometry drew 4.1% of
 * the frame while the physical one drew none of it, so the sky showed straight
 * through the river and 79% of the frame came back near-white.
 *
 * The frame is classified in the page rather than decoded here, and composited
 * over magenta first: the canvas clears to transparent, and a transparent pixel
 * reads as white once alpha is dropped — so without a marker colour "nothing
 * rendered" is indistinguishable from "white sky", which is how a blank frame
 * gets measured as if it were a scene.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mockBluetoothPath = path.resolve(__dirname, '../mock-bluetooth.js');

async function waitForDeviceConnected(page: Page, label: string) {
  await page.waitForFunction(
    (l) => {
      const containers = Array.from(document.querySelectorAll('.bluetooth-device-container'));
      const target = containers.find((c) =>
        c.querySelector('.device-name')?.textContent?.includes(l),
      );
      return target?.querySelector('.device-status')?.textContent?.includes('Connected') ?? false;
    },
    label,
    { timeout: 10_000 },
  );
}

/**
 * The harness is installed deliberately: it turns on preserveDrawingBuffer, and
 * without it the drawing buffer cannot be read back at all. Water and banks are
 * not gated on IS_TEST_MODE, so this is the same channel a rower sees.
 */
async function rowAndClassify(page: Page) {
  await page.addInitScript({ content: fs.readFileSync(mockBluetoothPath, 'utf8') });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('./');

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
  await page.evaluate(() =>
    (document.querySelector('.btn-start-workout') as HTMLButtonElement)?.click(),
  );
  await expect(page.locator('.rower3d-canvas-container')).toBeVisible({ timeout: 30_000 });
  await expectSceneAlive(page, 'the contrast scene');
  await page.waitForTimeout(6_000);

  return page.evaluate(() => {
    window.__ROWER3D_FORCE_RENDER?.();
    const canvas = document.querySelector('.rower3d-canvas-container canvas') as HTMLCanvasElement | null;
    if (!canvas) return null;

    const flat = document.createElement('canvas');
    flat.width = canvas.width;
    flat.height = canvas.height;
    const ctx = flat.getContext('2d');
    if (!ctx) return null;
    ctx.fillStyle = '#ff00ff';
    ctx.fillRect(0, 0, flat.width, flat.height);
    ctx.drawImage(canvas, 0, 0);

    const { data } = ctx.getImageData(0, 0, flat.width, flat.height);
    let ground = 0;
    let water = 0;
    let empty = 0;
    const total = flat.width * flat.height;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      if (r > 200 && b > 200 && g < 60) empty += 1;
      else if (g > r + 8 && g > b + 8) ground += 1;
      else if (b > r + 8 && b >= g) water += 1;
    }
    return { ground: ground / total, water: water / total, empty: empty / total };
  });
}

test('the waterway and the ground either side are told apart', async ({ page }) => {
  test.slow();

  const seen = await rowAndClassify(page);

  expect(seen, 'no canvas to classify').not.toBeNull();
  const { ground, water, empty } = seen!;
  console.log(
    `[contrast] ground=${(ground * 100).toFixed(1)}% water=${(water * 100).toFixed(1)}% ` +
      `empty=${(empty * 100).toFixed(1)}%`,
  );

  // Nothing rendered at all is a different failure, and worth naming separately.
  expect(empty, 'the frame was largely unrendered').toBeLessThan(0.2);

  // Both must be present. Water was 3.0% of the frame with the physical
  // material and 9.0% once it actually drew; ground sits around 14%. The floors
  // are well under both so this catches a surface disappearing, not a change of
  // framing.
  expect(water, 'no water is visible — the channel is not rendering').toBeGreaterThan(0.02);
  expect(ground, 'no ground is visible either side of the water').toBeGreaterThan(0.04);
});
