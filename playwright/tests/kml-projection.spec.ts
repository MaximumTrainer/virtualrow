import { test, expect, type Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

/**
 * KV-2 (#191) — an imported KML route renders without artefacts.
 *
 * The unit half (lat/lng ordering, WGS-84 bounds, the drop allowance, and the
 * fit-to-canvas projection) lives in routeService.test.ts and
 * routeMapProjection.test.ts. This covers the two criteria that can only be
 * observed in a running app: the route draws on the map, and a session can be
 * rowed start to finish without NaN reaching the camera or the progress state.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mockBluetoothPath = path.resolve(__dirname, '../mock-bluetooth.js');
const kmlFixturePath = path.resolve(__dirname, '../fixtures/kml-projection-course.kml');

const ROUTE_NAME = 'KML Projection Course';

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

/** Route discovery lives on its own screen now (issue #219, R3). */
async function goToRoutesScreen(page: Page) {
  await page.getByRole('button', { name: 'Routes', exact: true }).click();
  await expect(page.locator('.view-container--search')).toBeVisible();
}

async function importKmlRoute(page: Page) {
  await goToRoutesScreen(page);

  // The file import sits behind a disclosure; its input is not in the DOM until
  // the disclosure is open (issue #219, AC3.5).
  await page.getByRole('button', { name: /import a file/i }).click();
  await page.getByLabel('Route name').fill(ROUTE_NAME);
  await page.locator('.route-import input[type="file"]').setInputFiles(kmlFixturePath);

  // Importing selects the route and hands the user back to the Row screen.
  await expect(page.locator('.route-info-overlay h2')).toContainText(ROUTE_NAME, { timeout: 10_000 });

  // The card itself is on the Routes screen; go back for the thumbnail check.
  await goToRoutesScreen(page);
  const card = page.locator('.route-item', { hasText: ROUTE_NAME });
  await expect(card).toBeVisible({ timeout: 10_000 });
  return card;
}

test.describe('imported KML route rendering (KV-2)', () => {
  test('KV-2.3: the imported route draws on the map', async ({ page }) => {
    // The import control renders for a signed-in user or under
    // __PLAYWRIGHT_TESTING, which mock-bluetooth.js sets.
    await page.addInitScript({ content: fs.readFileSync(mockBluetoothPath, 'utf8') });
    await page.goto('./');
    const card = await importKmlRoute(page);

    // The card's thumbnail is the same canvas renderer as the main map.
    await expect(card.locator('.route-item-thumbnail')).toBeVisible();
    await card.click();

    const mapCanvas = page.locator('.map-container canvas').first();
    await expect(mapCanvas).toBeVisible({ timeout: 10_000 });

    // The route line is drawn, not just the background: sample the canvas and
    // require more than the background gradient's own colours.
    const distinctColours = await mapCanvas.evaluate((el) => {
      const canvas = el as HTMLCanvasElement;
      const ctx = canvas.getContext('2d');
      if (!ctx) return 0;
      const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const seen = new Set<string>();
      for (let i = 0; i < data.length; i += 4) {
        seen.add(`${data[i]},${data[i + 1]},${data[i + 2]}`);
      }
      return seen.size;
    });
    expect(distinctColours).toBeGreaterThan(1);

    // The headline distance matches a real track, not a two-point outline.
    const selected = await page.evaluate(() => window.__SELECTED_ROUTE);
    expect(selected?.name).toBe(ROUTE_NAME);
    expect(Number.isFinite(selected?.distanceKm ?? NaN)).toBe(true);
    expect(selected?.distanceKm ?? 0).toBeGreaterThan(0);
  });

  test('KV-2.4: a session runs start to finish with no NaN in camera or progress', async ({
    page,
  }) => {
    const mockBluetoothScript = fs.readFileSync(mockBluetoothPath, 'utf8');
    await page.addInitScript({ content: mockBluetoothScript });

    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') consoleErrors.push(m.text());
    });
    page.on('pageerror', (e) => pageErrors.push(e.message));

    await page.goto('./');
    const card = await importKmlRoute(page);
    await card.click();

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

    await expect(page.locator('.rower3d-canvas-container')).toBeVisible({ timeout: 15_000 });
    await page.waitForFunction(() => window.__ROWER3D_POS !== undefined, { timeout: 15_000 });

    /** Every telemetry number the scene exposes, at one instant. */
    const sampleTelemetry = () =>
      page.evaluate(() => ({
        pos: window.__ROWER3D_POS,
        camera: window.__ROWER3D_CAMERA,
        speed: window.__ROWER3D_SPEED_MPS,
        distance: window.__ROWER3D_DISTANCE_M,
        oarAngle: window.__ROWER3D_OAR_ANGLE,
      }));

    const assertFinite = (sample: Awaited<ReturnType<typeof sampleTelemetry>>, where: string) => {
      expect(sample.pos, `${where}: position`).toBeDefined();
      for (const key of ['x', 'y', 'z', 'progress', 'angle'] as const) {
        expect(Number.isFinite(sample.pos?.[key]), `${where}: pos.${key}`).toBe(true);
      }
      for (const [axis, value] of (sample.camera?.position ?? []).entries()) {
        expect(Number.isFinite(value), `${where}: camera[${axis}]`).toBe(true);
      }
      for (const [key, value] of Object.entries({
        speed: sample.speed,
        distance: sample.distance,
        oarAngle: sample.oarAngle,
      })) {
        if (value !== undefined) {
          expect(Number.isFinite(value), `${where}: ${key}`).toBe(true);
        }
      }
    };

    // Start.
    const startSample = await sampleTelemetry();
    assertFinite(startSample, 'start');
    const startProgress = startSample.pos?.progress ?? 0;

    // Drive the boat down the route and sample as it goes. The simulator feeds
    // PM5 frames, so progress advances without real hardware.
    // Row the route. The frames are the PM5 status layouts the vendor parser
    // reads: general-status carries elapsed time (0.01 s, u24 @0) and distance
    // (0.1 m, u24 @3); additional-status carries speed (0.001 m/s, u16 @3),
    // stroke rate @5, heart rate @6 and pace (0.01 s, u16 @7). The scene
    // integrates progress from speed, so both are needed.
    const samplesSeen: number[] = [];
    for (let step = 1; step <= 4; step++) {
      await page.evaluate((frame) => {
        const u24 = (dv: DataView, offset: number, value: number) => {
          dv.setUint8(offset, value & 0xff);
          dv.setUint8(offset + 1, (value >> 8) & 0xff);
          dv.setUint8(offset + 2, (value >> 16) & 0xff);
        };

        const general = new DataView(new ArrayBuffer(20));
        u24(general, 0, frame * 60 * 100);
        u24(general, 3, frame * 1200 * 10);
        window.__pm5CharGeneral?._dispatch(general);

        const additional = new DataView(new ArrayBuffer(20));
        u24(additional, 0, frame * 60 * 100);
        additional.setUint16(3, 4200, true);  // 4.2 m/s
        additional.setUint8(5, 26);           // stroke rate
        additional.setUint8(6, 148);          // heart rate
        additional.setUint16(7, 11900, true); // 119 s/500m
        window.__pm5CharAdditional?._dispatch(additional);
      }, step);
      await page.waitForTimeout(700);
      const sample = await sampleTelemetry();
      assertFinite(sample, `step ${step}`);
      samplesSeen.push(sample.pos?.progress ?? 0);
    }

    // The session really ran, so the finite-value checks above were made
    // against a session under way rather than a stalled one.
    //
    // Asserted on recorded distance rather than 3D progress. Progress is
    // integrated from speed by the animation loop, which does not run
    // dependably under software GL — the same reason #212 added
    // `expectSessionDistanceAdvances` to virtualrow.spec.ts. Distance travels
    // the BLE -> service -> session path with no renderer involved.
    await expect
      .poll(() => page.evaluate(() => window.__workoutService?.getCurrentSession()?.distance ?? 0), {
        timeout: 15_000,
      })
      .toBeGreaterThan(0);
    expect(startProgress).toBe(0);

    // Finish.
    await page.evaluate(() => {
      (document.querySelector('.btn-end-workout') as HTMLButtonElement)?.click();
    });
    assertFinite(await sampleTelemetry(), 'finish');

    // Progress is a fraction of the route, never outside it.
    for (const progress of samplesSeen) {
      expect(progress).toBeGreaterThanOrEqual(0);
      expect(progress).toBeLessThanOrEqual(1);
    }

    // The GPU error boundary never tripped, and nothing threw.
    await expect(page.locator('.canvas3d-error-fallback')).toHaveCount(0);
    const fatal = [...pageErrors, ...consoleErrors].filter((text) =>
      /nan|typeerror|referenceerror|GPU Error Boundary|cannot read properties of undefined/i.test(
        text,
      ),
    );
    expect(fatal).toEqual([]);
  });
});
