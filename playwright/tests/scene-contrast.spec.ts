import { test, expect, type Page } from '../fixtures/crash-watch';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { expectSceneAlive } from '../utils/scene-health';

/**
 * Issue #269 — the ground either side of the waterway must look different from
 * the water.
 *
 * It did not, twice over. First there was no water: the channel used a
 * MeshPhysicalMaterial whose realism came from `transmission`, which needs a
 * scene behind the surface to refract and had none, so the sky showed straight
 * through the river. Then there was no right bank: the two banks are mirror
 * images and both were wound the same way round, so one of them faced away from
 * the world and the material culled it (#280).
 *
 * The frame is classified in the page rather than decoded here, and composited
 * over magenta first: the canvas clears to transparent, and a transparent pixel
 * reads as white once alpha is dropped — so without a marker colour "nothing
 * rendered" is indistinguishable from "white sky", which is how a blank frame
 * gets measured as if it were a scene.
 *
 * What it measures is the frame against itself. An earlier version classified
 * pixels with hard-coded thresholds — `b - r > 55` for water, `g > r + 8` for
 * ground — which happened to fit two of the six themes and misread the rest:
 * on dystopian-thames both bank and water fell through as "other", and on
 * steampunk-henley the river counted as bank (#291).
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
 * without it the drawing buffer cannot be read back at all.
 *
 * The banks and the channel geometry are not gated on IS_TEST_MODE, so this is
 * the same ground and the same water a rower sees. The Gerstner wave shader and
 * the reflection plane are gated, so the surface measured here is flatter than
 * the one in a real session.
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

    const apart = (a: [number, number, number], b: [number, number, number]) =>
      Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

    const median = (values: number[]) => {
      if (!values.length) return 0;
      values.sort((a, b) => a - b);
      return values[Math.floor(values.length / 2)];
    };

    /** The sky, taken from the top of the frame where there is nothing else. */
    const skyReds: number[] = [];
    const skyGreens: number[] = [];
    const skyBlues: number[] = [];
    for (let y = 0; y < Math.floor(H * 0.06); y += 1) {
      for (let x = Math.floor(W * 0.4); x < Math.floor(W * 0.6); x += 2) {
        const [r, g, b] = at(x, y);
        skyReds.push(r);
        skyGreens.push(g);
        skyBlues.push(b);
      }
    }
    const sky: [number, number, number] = [
      median(skyReds),
      median(skyGreens),
      median(skyBlues),
    ];

    /**
     * What a vertical strip of the frame is made of, ignoring the sky.
     *
     * Strips with the sky filtered out, rather than a patch at coordinates
     * chosen by eye. Where the banks appear depends on which way the route is
     * bending and how far down the canvas the scene sits: a fixed band lands in
     * the open foreground on one route and in the sky on another, and then it
     * is measuring the framing instead of the ground. A strip that turns out to
     * be nothing but sky reports no content at all, which is precisely the
     * failure worth catching.
     */
    const contentOf = (xFrom: number, xTo: number) => {
      const reds: number[] = [];
      const greens: number[] = [];
      const blues: number[] = [];
      let looked = 0;
      for (let y = 0; y < H; y += 2) {
        for (let x = Math.floor(xFrom * W); x < Math.floor(xTo * W); x += 2) {
          const [r, g, b] = at(x, y);
          looked += 1;
          if (apart([r, g, b], sky) <= 40) continue;
          reds.push(r);
          greens.push(g);
          blues.push(b);
        }
      }
      return {
        colour: [median(reds), median(greens), median(blues)] as [number, number, number],
        share: looked ? reds.length / looked : 0,
      };
    };

    const middle = contentOf(0.42, 0.58);
    const left = contentOf(0.0, 0.12);
    const right = contentOf(0.88, 1.0);

    /**
     * How much of a strip is something other than the water, and other than
     * the sky.
     *
     * The median above answers "what colour is most of this strip", which was
     * a fair question while the water was a narrow ribbon down the middle of
     * the frame. Since the world is built in metres (#321) the river is as wide
     * as a river, so water is most of every strip and the median says "water"
     * on both sides even with banks plainly in the picture. This counts the
     * ground instead of polling the column, so it does not care where in the
     * frame the bank sits - which is just as well, because #328 moves the
     * camera next.
     */
    const groundShareOf = (xFrom: number, xTo: number, water: [number, number, number]) => {
      let nonSky = 0;
      let ground = 0;
      for (let y = 0; y < H; y += 2) {
        for (let x = Math.floor(xFrom * W); x < Math.floor(xTo * W); x += 2) {
          const [r, g, b] = at(x, y);
          if (apart([r, g, b], sky) <= 40) continue;
          nonSky += 1;
          if (apart([r, g, b], water) > 60) ground += 1;
        }
      }
      return nonSky ? ground / nonSky : 0;
    };

    const leftGroundShare = groundShareOf(0.0, 0.12, middle.colour);
    const rightGroundShare = groundShareOf(0.88, 1.0, middle.colour);

    let empty = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] > 200 && data[i + 2] > 200 && data[i + 1] < 60) empty += 1;
    }

    return {
      empty: empty / (W * H),
      water: middle.colour,
      leftGround: left.colour,
      rightGround: right.colour,
      sky,
      leftShare: left.share,
      rightShare: right.share,
      leftGroundShare,
      rightGroundShare,
      waterToLeft: apart(middle.colour, left.colour),
      waterToRight: apart(middle.colour, right.colour),
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
    const {
      empty, water, leftGround, rightGround, sky, leftShare, rightShare,
      waterToLeft, waterToRight, leftGroundShare, rightGroundShare,
    } = seen!;

    const show = (c: [number, number, number]) => `rgb(${c.join(',')})`;
    console.log(
      `[contrast ${tier}] water=${show(water)} left=${show(leftGround)} ` +
        `right=${show(rightGround)} sky=${show(sky)} | water-to-bank ` +
        `${waterToLeft.toFixed(0)}/${waterToRight.toFixed(0)} | non-sky share ` +
        `${(leftShare * 100).toFixed(0)}%/${(rightShare * 100).toFixed(0)}% | ground share ` +
        `${(leftGroundShare * 100).toFixed(0)}%/${(rightGroundShare * 100).toFixed(0)}% ` +
        `empty=${(empty * 100).toFixed(1)}%`,
    );

    // Nothing rendered at all is a different failure, and worth naming separately.
    expect(empty, 'the frame was largely unrendered').toBeLessThan(0.2);

    // There is something other than sky out there, on both sides.
    //
    // The right bank was missing for a long time and the frame simply showed
    // sky in its place, with this spec passing because it only ever counted
    // ground in total and one bank was enough to satisfy that (#269).
    for (const [side, share] of [
      ['left', leftShare],
      ['right', rightShare],
    ] as const) {
      expect(
        share,
        `only ${(share * 100).toFixed(0)}% of the ${side} of the frame is anything other ` +
          'than sky, so there is no ground on that side',
      ).toBeGreaterThan(0.2);
    }

    // And there is ground out there, visibly different from the water.
    //
    // Counted rather than averaged. An earlier version took the median colour
    // of each outer strip and asked how far it sat from the water's; that held
    // while the water was a narrow ribbon down the middle of the frame, and
    // stopped holding the moment the world was built in metres (#321) and the
    // river became as wide as a river. Water is now most of every strip, so
    // the median reads "water" on both sides with the banks plainly in shot.
    //
    // What the acceptance criterion actually says is that the ground either
    // side looks different from the water. So: of everything on that side of
    // the frame that is not sky, how much of it is not water either. Zero is
    // the missing right bank (#280); zero is also a bank drawn the colour of
    // the river (#269). Neither can hide behind an average.
    const DISTINCT_SHARE = 0.08;

    for (const [side, share] of [
      ['left', leftGroundShare],
      ['right', rightGroundShare],
    ] as const) {
      expect(
        share,
        `only ${(share * 100).toFixed(0)}% of the ${side} of the frame is ground that ` +
          'looks any different from the water, so there is no bank anyone could see',
      ).toBeGreaterThan(DISTINCT_SHARE);
    }
  });
}
