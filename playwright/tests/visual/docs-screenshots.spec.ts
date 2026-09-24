import { test, expect, type Page } from '../../fixtures/crash-watch';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { expectSceneAlive } from '../../utils/scene-health';

/**
 * Issue #362 — the published screenshots, compared rather than overwritten.
 *
 * The landing page shows three pictures of the app: `docs/screenshot-rower-3d.png`
 * (the hero), `docs/screenshot-activity.png` and `docs/screenshot-route-selection.png`.
 * They used to be written into the working tree by a block in virtualrow.spec.ts
 * that every CI run executed and then threw away, so the only way a published
 * picture changed was a developer noticing three modified PNGs after a local
 * run - on their own GPU. The committed ones went on showing the scene from
 * before #321 rescaled it, and nothing was red.
 *
 * Here they are baselines. This spec runs in its own project of the visual
 * config (`playwright.config.visual.ts`), whose snapshot path is `docs/`
 * itself: the file the site publishes *is* the file this compares against, so
 * there is no copy under `__snapshots__/` to keep in step with it. A change
 * that moves one of the pictures fails the `visual` job and names the file; a
 * pull request labelled `visual-baseline` re-records all three on SwiftShader
 * and hands them back as an artifact to commit - the same route #340 built for
 * the scene baselines, not a second one beside it.
 *
 * What the pictures show is unchanged: the bundled Willowbrook River, a PM5 and
 * heart-rate strap connected through `mock-bluetooth.js`, three minutes and a
 * kilometre rowed. What is new is that the scene holds still for them
 * (`__ROWER3D_FREEZE`), because a baseline of a moving boat is a baseline of
 * whenever the shutter happened to open.
 *
 * Whether the hero is *worth* publishing is a separate question, answered by
 * `src/__tests__/heroScreenshot.test.ts` over the committed file (#362 R3).
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mockBluetoothPath = path.resolve(__dirname, '../../mock-bluetooth.js');

/** The route every published picture is of: the one the app opens on. */
const ROUTE_NAME = 'Willowbrook River';

/**
 * Where the boat is pinned, and at what second.
 *
 * The boat and the minimap marker both follow the PM5's own distance, which
 * the last frame below puts at 1500 m - 0.3 of the 5 km course. Pinning the
 * scene there keeps the boat where the minimap says it is, as it was when these
 * were captured from a live row.
 */
const FREEZE = { time: 12.5, progress: 0.3 };

/** The rowing the activity shot reports: 3:00, 1000 m, 26 spm, 148 bpm. */
const ROWED = { strokeRate: 26, heartRate: 148 } as const;

/** Scenery GLBs, textures and the effect stack arrive after the first frame. */
const SETTLE_MS = 8_000;

/** Two readbacks and PNG encodes of a SwiftShader canvas; see scene.spec.ts. */
const CAPTURE_TIMEOUT_MS = 30_000;

/**
 * The same tolerance as the scene baselines.
 *
 * SwiftShader is deterministic frame to frame but not bit-identical across
 * Chromium builds; anything past this is a picture that has changed.
 */
const COMPARISON = {
  maxDiffPixelRatio: 0.01,
  threshold: 0.3,
  animations: 'disabled',
  timeout: CAPTURE_TIMEOUT_MS,
} as const;

/**
 * The panels the hero hides so the scull is centre-stage.
 *
 * The HUD's two visible pieces joined them with #335, which put the metric
 * strip on the stage. The hero is a picture of the river and the boat - that is
 * what `heroScreenshot.test.ts` measures it as - and the strip is a band of
 * live numbers across the bottom third of it. The activity shot below is the
 * one that shows the HUD, which is what that picture is for.
 *
 * `.row-hud-strip` and `.row-hud-actions` rather than `.row-hud`: that is a
 * full-stage layer with nothing drawn on it, and hiding it would take the two
 * pieces with it - which is the same result by a less obvious route, until
 * someone adds a third piece outside the strip and cannot see why it vanished.
 */
const HERO_HIDDEN_OVERLAYS = [
  '.activity-route-summary',
  '.activity-map-overlay',
  '.row-hud-strip',
  '.row-hud-actions',
] as const;

async function waitForRowScreen(page: Page) {
  await page.waitForSelector('.route-info-overlay h2', { timeout: 10_000 });
}

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
    { timeout: 15_000 },
  );
}

/** PM5 general status — the wire format parsed by src/vendor/pm5-base.js. */
function dispatchGeneralStatus(page: Page, distanceMeters: number, elapsedSeconds: number) {
  return page.evaluate(
    ({ distanceMeters, elapsedSeconds }) => {
      const v = new Uint8Array(11);
      const cs = Math.round(elapsedSeconds * 100);
      v[0] = cs & 0xff; v[1] = (cs >> 8) & 0xff; v[2] = (cs >> 16) & 0xff;
      const dm = Math.round(distanceMeters * 10);
      v[3] = dm & 0xff; v[4] = (dm >> 8) & 0xff; v[5] = (dm >> 16) & 0xff;
      v[10] = 2; // strokeState = rowing
      window.__pm5CharGeneral?._dispatch(new DataView(v.buffer));
    },
    { distanceMeters, elapsedSeconds },
  );
}

/** PM5 additional status — same parser, its own characteristic. */
function dispatchAdditionalStatus(page: Page, elapsedSeconds: number) {
  return page.evaluate(
    ({ elapsedSeconds, strokeRate, heartRate }) => {
      const v = new Uint8Array(11);
      const cs = Math.round(elapsedSeconds * 100);
      v[0] = cs & 0xff; v[1] = (cs >> 8) & 0xff; v[2] = (cs >> 16) & 0xff;
      v[3] = 0xd0; v[4] = 0x07;   // speed 2.000 m/s
      v[5] = strokeRate;
      v[6] = heartRate;
      v[7] = 0x1c; v[8] = 0x2e;   // currentPace 118.04 s/500m
      v[9] = 0x1c; v[10] = 0x2e;  // averagePace
      window.__pm5CharAdditional?._dispatch(new DataView(v.buffer));
    },
    { elapsedSeconds, ...ROWED },
  );
}

/** Heart Rate Measurement, 8-bit bpm. */
function dispatchHeartRate(page: Page) {
  return page.evaluate((bpm) => {
    const v = new Uint8Array([0x00, bpm]);
    window.__hrChar?._dispatch(new DataView(v.buffer));
  }, ROWED.heartRate);
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript((freeze) => {
    window.__ROWER3D_FREEZE = freeze;
  }, FREEZE);
  await page.addInitScript({ content: fs.readFileSync(mockBluetoothPath, 'utf8') });
  await page.goto('./');
  await waitForRowScreen(page);
});

test('the published route selection screen is what the app shows', async ({ page }) => {
  await expect(page.locator('.route-info-overlay h2')).toContainText(ROUTE_NAME);

  // The viewport only, so the selected route and its map fill the frame (the
  // route list is its own screen, #219 R3).
  await expect(page).toHaveScreenshot('screenshot-route-selection.png', {
    ...COMPARISON,
    fullPage: false,
  });
});

test('the published activity screen and hero are what the app renders', async ({ page }) => {
  test.slow();

  await expect(page.locator('.route-info-overlay h2')).toContainText(ROUTE_NAME);

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

  await page.waitForFunction(
    () => {
      const btn = document.querySelector('.btn-start-workout') as HTMLButtonElement | null;
      return !!(btn && !btn.disabled);
    },
    undefined,
    { timeout: 10_000 },
  );
  // Through evaluate: the 3D canvas intercepts pointer events over the button.
  await page.evaluate(() =>
    (document.querySelector('.btn-start-workout') as HTMLButtonElement)?.click(),
  );
  await page.waitForFunction(() => !!window.__workoutService?.getCurrentSession?.(), undefined, {
    timeout: 5_000,
  });
  await page.waitForSelector('.activity-view', { timeout: 10_000 });

  const canvas = page.locator('.rower3d-canvas-container canvas').first();
  await expect(canvas).toBeVisible({ timeout: 30_000 });

  // The same three frames the live capture sent, at the same pace - the
  // first is the baseline the session measures from, so the tiles read
  // 3:00 and 1000 m.
  for (let i = 1; i <= 3; i += 1) {
    await dispatchGeneralStatus(page, 500 * i, 60 * i);
    await dispatchAdditionalStatus(page, 60 * i);
    await dispatchHeartRate(page);
    await page.waitForTimeout(600);
  }
  // The distance tile, by its own label rather than by a phrase in the page.
  // It read `toContainText('1000 m')` until #344 moved the unit into the
  // label - the tile is `1000` under `METERS` now - and because this wait sits
  // ahead of the shutter, it did not fail loudly: `test:visual:update` stopped
  // here and the published screenshots were quietly left as they were.
  await expect(
    page.locator('.activity-stat-card', { hasText: 'Meters' }).locator('.activity-stat-value'),
  ).toHaveText('1000');

  await expectSceneAlive(page, 'the scene about to be compared with the published activity shot');
  await page.waitForFunction(() => window.__ROWER3D_ROUTE?.hasCurve === true, undefined, {
    timeout: 30_000,
  });
  await page.waitForTimeout(SETTLE_MS);

  const progress = await page.evaluate(() => window.__ROWER3D_POS?.progress ?? -1);
  expect(progress, 'the scene did not honour __ROWER3D_FREEZE').toBeCloseTo(FREEZE.progress, 3);

  // 1. The activity screen, viewport only, so the 3D canvas is centre-stage.
  //    Soft, so a drift here still lets the hero report its own.
  await page.evaluate(() => window.__ROWER3D_FORCE_RENDER?.());
  await expect.soft(page).toHaveScreenshot('screenshot-activity.png', {
    ...COMPARISON,
    fullPage: false,
  });

  // 2. The hero - a composed shot, not a raw frame (#362 R4).
  //
  // The in-stage overlays are hidden rather than masked: a mask paints over
  // the picture, and this picture is the one the site publishes. The stage
  // itself is not resized - aggressive width/height overrides on it lose the
  // WebGL context on headless SwiftShader and photograph the error boundary.
  await page.evaluate((selectors) => {
    const style = document.createElement('style');
    style.id = 'docs-hero-screenshot-style';
    style.textContent = `${selectors.join(',\n')} { display: none !important; }`;
    document.head.appendChild(style);
  }, [...HERO_HIDDEN_OVERLAYS]);
  // Until the hidden state is actually applied, not for a fixed time.
  await page.waitForFunction(
    (selectors) =>
      selectors.every((selector) => {
        const el = document.querySelector(selector);
        return !el || window.getComputedStyle(el).display === 'none';
      }),
    [...HERO_HIDDEN_OVERLAYS],
    { timeout: 2_000 },
  );

  // Clipped to the route stage, so the scull fills the frame without the
  // sidebar or the tiles. A page clip rather than an element shot, as the
  // capture always was: the stage is a container, not the canvas.
  // No box is a failure rather than a full-page fallback: an unclipped frame
  // is a different picture from the one the site publishes.
  const routeStage = await page.locator('.activity-route-stage').boundingBox({ timeout: 5_000 });
  if (!routeStage) throw new Error('the route stage has no box to clip the hero to');

  // A complete frame before the shutter. The renderer clears to a transparent
  // buffer and a frame is slow here, so a capture on its own schedule usually
  // lands between two frames - which is how an empty gradient once shipped as
  // the hero (#261).
  await page.evaluate(() => window.__ROWER3D_FORCE_RENDER?.());
  // And the scene alive before it is compared with what the site publishes
  // (#283, #290): a context-lost banner is not a picture of the river.
  await expectSceneAlive(page, 'the scene about to be compared with the published hero');
  await expect(page).toHaveScreenshot('screenshot-rower-3d.png', {
    ...COMPARISON,
    clip: routeStage,
  });
});
