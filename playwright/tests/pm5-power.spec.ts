import { test, expect, type Page } from '../fixtures/crash-watch';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { useSimServer, releaseSimServer, emitPm5 } from '../utils/sim-server';

/**
 * A Concept2 rower has to see their power (#306).
 *
 * Found by rowing the app rather than reading it: every other live metric
 * updated and the Power card sat at 0 W for the whole session, then the
 * summary reported Avg Power 0 W. `bluetoothService` read `data.averagePower`
 * and no PM5 frame has ever carried a field by that name — the wrapper had no
 * listener and no parser for the characteristic power actually arrives on.
 *
 * No spec caught it because the mock sent no power either. So this spec is
 * only possible because `buildPM5AdditionalStrokeDataView` now exists, and it
 * is the half of the fix that stops the fault coming back.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mockBluetoothPath = path.resolve(__dirname, '../mock-bluetooth.js');

/** What a club rower holds, and would notice the absence of. */
const STEADY_WATTS = 187;

let simulatorReady = false;
test.beforeAll(async () => {
  simulatorReady = await useSimServer();
});
test.afterAll(async () => {
  await releaseSimServer();
});

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

/** The Power card's value, as the rower reads it. */
const powerCardText = (page: Page) =>
  page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll('.activity-stat-card'));
    const card = cards.find((c) =>
      c.querySelector('.activity-stat-label')?.textContent?.trim() === 'Power',
    );
    return card?.querySelector('.activity-stat-value')?.textContent?.trim() ?? '';
  });

test('a PM5 rower sees their power, live and in the summary', async ({ page }) => {
  test.slow();
  expect(simulatorReady, 'the PM5 simulator is not reachable').toBe(true);

  await page.addInitScript({ content: fs.readFileSync(mockBluetoothPath, 'utf8') });
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
  await expect(page.locator('.btn-start-workout')).toBeEnabled({ timeout: 15_000 });
  await page.evaluate(() =>
    (document.querySelector('.btn-start-workout') as HTMLButtonElement)?.click(),
  );
  await expect(page.locator('.rower3d-canvas-container')).toBeVisible({ timeout: 30_000 });

  // Row at a steady wattage, the way the fault was found.
  let distance = 0;
  for (let second = 1; second <= 8; second += 1) {
    distance += 4.17;
    await emitPm5({
      distance: Math.round(distance),
      elapsedTime: second,
      pace: 120,
      cadence: 24,
      power: STEADY_WATTS,
      heartRate: 140,
    });
    await page.waitForTimeout(400);
  }

  // The card the rower is looking at. Read as text, because "0 W" and "187 W"
  // are what they actually see and the fault was a plausible-looking zero.
  await expect
    .poll(() => powerCardText(page), { timeout: 20_000, intervals: [500] })
    .toBe(`${STEADY_WATTS} W`);

  // And it reached the session, which is what the summary averages and what
  // the FIT export and the intervals.icu upload carry.
  const session = await page.evaluate(() => {
    const current = window.__workoutService?.getCurrentSession?.();
    return current ? { samples: current.samples?.length ?? 0 } : null;
  });
  expect(session, 'there was no session to record power into').not.toBeNull();

  const recordedPower = await page.evaluate(() => {
    const current = window.__workoutService?.getCurrentSession?.();
    const samples = (current?.samples ?? []) as Array<{ power?: number }>;
    return samples.map((s) => s.power ?? 0);
  });

  expect(recordedPower.length, 'no samples were recorded').toBeGreaterThan(0);
  expect(
    Math.max(...recordedPower),
    `every recorded sample had zero power: ${JSON.stringify(recordedPower.slice(0, 10))}`,
  ).toBe(STEADY_WATTS);
});
