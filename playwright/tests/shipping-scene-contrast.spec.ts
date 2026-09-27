import { test, expect, type Page } from '../fixtures/crash-watch';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { expectSceneAlive } from '../utils/scene-health';

/**
 * #419 — measure the scene that ships, not the one automation trims for cost.
 *
 * `scene-contrast.spec.ts` and its siblings run against a scene with the PMREM
 * environment, the water mirror, the wake, the spray, the contact shadow and
 * the GLB scull all dropped, because each of those was a source of flake or
 * of a four-second main-thread block on the software rasteriser CI draws with.
 * The trade was documented in `renderBudget.ts`: 186 draw calls under
 * automation against 1 114 outside it. Six times the work, outside the thing
 * that measures it.
 *
 * `__VIRTUALROW_SHIPPING_SCENE` (added in this issue) turns those cost gates
 * off for one spec — which is why this is its own file, not another case
 * bolted onto `scene-contrast`. The contrast floors it inherits are the same
 * ones the trimmed scene meets; the interest is whether the shipping scene
 * meets them too, and what the draw-call and triangle figures come out at.
 * The numbers go to the log so the gap between the two scenes stays a figure
 * in CI rather than a discovery during a later issue (#419 AC3.2).
 *
 * A failure of the contrast floor here is a real bug — the scene a rower gets
 * has a bank they cannot tell from the water — and never a reason to lower
 * the floor (#419 AC3.3).
 *
 * `test.slow()` is set because the shipping scene really is more expensive:
 * one PMREM convolution alone blocks the main thread for about four seconds
 * on the runner. If it turns out to consistently push the suite over its
 * ceiling, this spec moves to its own job the way endurance and stress do.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
/** Same distance as `scene-contrast.spec.ts`; keep them in step. */
const GROUND_APART = 40;
/** Same share as `scene-contrast.spec.ts`; keep them in step. */
const DISTINCT_SHARE = 0.08;

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

async function rowShippingSceneAndClassify(page: Page) {
  // The shipping-scene flag is set BEFORE the SPA boots, exactly like
  // __VIRTUALROW_PERFORMANCE_MODE — `RENDER_SHIPPING_EXTRAS` is a module-load
  // constant and would be read once, so a later window.set would come too late.
  await page.addInitScript(() => {
    (window as unknown as { __VIRTUALROW_SHIPPING_SCENE?: boolean })
      .__VIRTUALROW_SHIPPING_SCENE = true;
    (window as unknown as { __VIRTUALROW_PERFORMANCE_MODE?: string })
      .__VIRTUALROW_PERFORMANCE_MODE = 'auto';
  });
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
  await expectSceneAlive(page, 'the shipping-scene contrast test');

  // The wait is longer than in `scene-contrast.spec.ts`: PMREM building blocks
  // the main thread for about four seconds on the software rasteriser, and the
  // GLB scull is asynchronous. A horizon is only ready once both have landed.
  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          const canvas = document.querySelector(
            '.rower3d-canvas-container canvas',
          ) as HTMLCanvasElement | null;
          if (!canvas) return 0;
          const flat = document.createElement('canvas');
          flat.width = canvas.width;
          flat.height = canvas.height;
          const ctx = flat.getContext('2d');
          if (!ctx) return 0;
          ctx.drawImage(canvas, 0, 0);
          const band = Math.max(1, flat.height >> 4);
          const meanLuma = (y: number) => {
            const { data } = ctx.getImageData(0, y, flat.width, band);
            let sum = 0;
            for (let i = 0; i < data.length; i += 4) {
              sum += 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
            }
            return sum / (data.length / 4);
          };
          const top = meanLuma(0);
          const bottom = meanLuma(flat.height - band - 1);
          if (top < 100) return 0;
          return Math.abs(top - bottom);
        }),
      {
        timeout: 90_000,
        intervals: [1000, 2000, 3000],
        message:
          'the shipping scene never gained a horizon — PMREM or the GLB scull may not have landed',
      },
    )
    .toBeGreaterThan(40);

  return page.evaluate((groundApart) => {
    (window as { __ROWER3D_FORCE_RENDER?: () => void }).__ROWER3D_FORCE_RENDER?.();
    const canvas = document.querySelector(
      '.rower3d-canvas-container canvas',
    ) as HTMLCanvasElement | null;
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

    const at = (x: number, y: number): [number, number, number] => {
      const i = (y * W + x) * 4;
      return [data[i], data[i + 1], data[i + 2]];
    };
    const median = (samples: [number, number, number][]): [number, number, number] => {
      if (samples.length === 0) return [0, 0, 0];
      const sorted = (i: number) =>
        [...samples].map((s) => s[i]).sort((a, b) => a - b)[Math.floor(samples.length / 2)];
      return [sorted(0), sorted(1), sorted(2)];
    };
    const distance = (a: [number, number, number], b: [number, number, number]) =>
      Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    const isEmpty = (c: [number, number, number]) => c[0] === 0xff && c[1] === 0x00 && c[2] === 0xff;

    // The centre band is water, the sides are ground, the top is sky.
    const waterSamples: [number, number, number][] = [];
    const leftSamples: [number, number, number][] = [];
    const rightSamples: [number, number, number][] = [];
    const skySamples: [number, number, number][] = [];
    let empty = 0;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const c = at(x, y);
        if (isEmpty(c)) {
          empty++;
          continue;
        }
        if (y < H * 0.25 && x > W * 0.3 && x < W * 0.7) skySamples.push(c);
        else if (y > H * 0.55 && x > W * 0.4 && x < W * 0.6) waterSamples.push(c);
        else if (y > H * 0.5 && x < W * 0.2) leftSamples.push(c);
        else if (y > H * 0.5 && x > W * 0.8) rightSamples.push(c);
      }
    }

    const water = median(waterSamples);
    const leftGround = median(leftSamples);
    const rightGround = median(rightSamples);
    const sky = median(skySamples);

    const nonSky = (side: [number, number, number][]) =>
      side.filter((c) => distance(c, sky) > 40);
    const nonWaterGround = (side: [number, number, number][]) =>
      side.filter((c) => distance(c, sky) > 40 && distance(c, water) > groundApart);

    return {
      empty: empty / (W * H),
      water,
      leftGround,
      rightGround,
      sky,
      waterToLeft: distance(water, leftGround),
      waterToRight: distance(water, rightGround),
      leftShare: nonSky(leftSamples).length / Math.max(1, leftSamples.length),
      rightShare: nonSky(rightSamples).length / Math.max(1, rightSamples.length),
      leftGroundShare: nonWaterGround(leftSamples).length / Math.max(1, leftSamples.length),
      rightGroundShare: nonWaterGround(rightSamples).length / Math.max(1, rightSamples.length),
      renderStats: (
        window as unknown as {
          __ROWER3D_RENDER_STATS?: { calls?: number; triangles?: number };
        }
      ).__ROWER3D_RENDER_STATS,
    };
  }, GROUND_APART);
}

test('the shipping scene meets the contrast floors (#419)', async ({ page }) => {
  test.slow();

  const seen = await rowShippingSceneAndClassify(page);

  expect(seen, 'no canvas to classify').not.toBeNull();
  const {
    empty, water, leftGround, rightGround, sky, leftShare, rightShare,
    waterToLeft, waterToRight, leftGroundShare, rightGroundShare, renderStats,
  } = seen!;

  const show = (c: [number, number, number]) => `rgb(${c.join(',')})`;
  // Draw calls and triangles are the point of the log line: the gap between
  // this scene and the trimmed one shows up next to the contrast numbers.
  console.log(
    `[shipping-contrast auto] water=${show(water)} left=${show(leftGround)} ` +
      `right=${show(rightGround)} sky=${show(sky)} | water-to-bank ` +
      `${waterToLeft.toFixed(0)}/${waterToRight.toFixed(0)} | non-sky share ` +
      `${(leftShare * 100).toFixed(0)}%/${(rightShare * 100).toFixed(0)}% | ground share ` +
      `${(leftGroundShare * 100).toFixed(0)}%/${(rightGroundShare * 100).toFixed(0)}% ` +
      `empty=${(empty * 100).toFixed(1)}% ` +
      `calls=${renderStats?.calls ?? 'n/a'} triangles=${renderStats?.triangles ?? 'n/a'}`,
  );

  expect(empty, 'the shipping-scene frame was largely unrendered').toBeLessThan(0.2);

  for (const [side, share] of [
    ['left', leftShare],
    ['right', rightShare],
  ] as const) {
    expect(
      share,
      `only ${(share * 100).toFixed(0)}% of the ${side} of the shipping-scene frame is ` +
        'anything other than sky, so there is no ground on that side',
    ).toBeGreaterThan(0.2);
  }

  for (const [side, share] of [
    ['left', leftGroundShare],
    ['right', rightGroundShare],
  ] as const) {
    expect(
      share,
      `only ${(share * 100).toFixed(0)}% of the ${side} of the shipping-scene frame is ` +
        'ground that looks any different from the water — the scene a rower sees has no bank',
    ).toBeGreaterThan(DISTINCT_SHARE);
  }
});
