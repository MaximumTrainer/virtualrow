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
async function rowAndClassify(page: Page, tier: 'low' | 'auto' | 'high') {
  await page.addInitScript((m) => {
    (window as unknown as { __VIRTUALROW_PERFORMANCE_MODE?: string })
      .__VIRTUALROW_PERFORMANCE_MODE = m as string;
  }, tier);
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
    const W = flat.width;
    const H = flat.height;
    let ground = 0;
    let water = 0;
    let empty = 0;
    const total = W * H;

    const classify = (x: number, y: number): 'empty' | 'ground' | 'water' | 'other' => {
      const i = (y * W + x) * 4;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      if (r > 200 && b > 200 && g < 60) return 'empty';
      if (g > r + 8 && g > b + 8) return 'ground';
      // Strongly blue, which the sky is not.
      //
      // The sky is faintly blue at the top of the frame and hazier lower down -
      // around (225, 232, 236) and (103, 122, 140) - so 'more blue than red'
      // called both of them water. The rightmost water in a row was then a sky
      // pixel at the frame edge, with nothing outboard of it to find. The
      // channel is around (13, 60, 95): far bluer than either.
      if (b - r > 55 && b >= g && b < 210) return 'water';
      return 'other';
    };

    for (let y = 0; y < H; y += 1) {
      for (let x = 0; x < W; x += 1) {
        const kind = classify(x, y);
        if (kind === 'empty') empty += 1;
        else if (kind === 'ground') ground += 1;
        else if (kind === 'water') water += 1;
      }
    }

    // Is the channel flanked by ground on BOTH sides?
    //
    // Every row that has water in it is a row across the river, so those are the
    // rows that can answer the question - and only those. The lower part of the
    // frame is below the banks entirely, looking at the boat and open ground, so
    // a fixed band there finds no water and measures nothing.
    //
    // For each such row, find the water and ask whether there is any ground
    // outboard of it, left and right. A bank that is not drawn leaves sky out to
    // the frame edge.
    let rowsWithWater = 0;
    let rowsGroundLeft = 0;
    let rowsGroundRight = 0;
    for (let y = 0; y < H; y += 2) {
      let first = -1;
      let last = -1;
      for (let x = 0; x < W; x += 1) {
        if (classify(x, y) === 'water') {
          if (first < 0) first = x;
          last = x;
        }
      }
      if (first < 0) continue;
      // A row has to cross the bank to say anything about it. A row of pure sky
      // has no ground in it at all, and reporting 'no ground to the right' of it
      // would be true and meaningless. A row with a missing bank still has the
      // other bank in it, so this excludes the sky without excluding the defect.
      let hasGround = false;
      for (let x = 0; x < W; x += 1) {
        if (classify(x, y) === 'ground') { hasGround = true; break; }
      }
      if (!hasGround) continue;
      rowsWithWater += 1;
      for (let x = 0; x < first; x += 1) {
        if (classify(x, y) === 'ground') { rowsGroundLeft += 1; break; }
      }
      for (let x = W - 1; x > last; x -= 1) {
        if (classify(x, y) === 'ground') { rowsGroundRight += 1; break; }
      }
    }

    return {
      ground: ground / total,
      water: water / total,
      empty: empty / total,
      rowsWithWater,
      groundLeft: rowsWithWater ? rowsGroundLeft / rowsWithWater : 0,
      groundRight: rowsWithWater ? rowsGroundRight / rowsWithWater : 0,
    };
  });
}

// Every tier, because the acceptance criterion says every tier and because they
// do not draw the same picture: auto and high add the effect stack over the same
// geometry, and a grade that washes the banks out would be invisible to a check
// that only ever looked at low.
for (const tier of ['low', 'auto', 'high'] as const) {
test(`the waterway and the ground either side are told apart at ${tier}`, async ({ page }) => {
  test.slow();

  const seen = await rowAndClassify(page, tier);

  expect(seen, 'no canvas to classify').not.toBeNull();
  const { ground, water, empty, rowsWithWater, groundLeft, groundRight } = seen!;
  console.log(
    `[contrast ${tier}] ground=${(ground * 100).toFixed(1)}% water=${(water * 100).toFixed(1)}% ` +
      `empty=${(empty * 100).toFixed(1)}% | rows=${rowsWithWater} ` +
      `groundLeft=${(groundLeft * 100).toFixed(0)}% groundRight=${(groundRight * 100).toFixed(0)}%`,
  );

  // Nothing rendered at all is a different failure, and worth naming separately.
  expect(empty, 'the frame was largely unrendered').toBeLessThan(0.2);

  // Both must be present. Water was 3.0% of the frame with the physical
  // material and 9.0% once it actually drew; ground sits around 14%. The floors
  // are well under both so this catches a surface disappearing, not a change of
  // framing.
  expect(water, 'no water is visible — the channel is not rendering').toBeGreaterThan(0.02);
  expect(ground, 'no ground is visible either side of the water').toBeGreaterThan(0.04);

  // Either side means both sides.
  //
  // The total above was satisfied by one bank on its own, and for a long time
  // that is all there was: the two banks are mirrored, both were wound the same
  // way round, and the material culls back faces - so the right bank was never
  // drawn. The published hero showed water, a green left bank, and sky where the
  // right bank should have been, with this spec passing (#269).
  expect(rowsWithWater, 'no water was found in the lower frame to measure against')
    .toBeGreaterThan(10);
  expect(groundLeft, 'no ground to the left of the channel').toBeGreaterThan(0.5);
  expect(groundRight, 'no ground to the right of the channel').toBeGreaterThan(0.5);
});
}
