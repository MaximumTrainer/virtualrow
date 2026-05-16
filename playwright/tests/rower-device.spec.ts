import { test, expect, type Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mockBluetoothPath = path.resolve(__dirname, '../mock-bluetooth.js');

type SimWindow = Window & typeof globalThis & {
  __ftmsChar?: { _dispatch: (value: DataView) => void };
  __simulator?: {
    startFtmsRoute: (id: string, options: Record<string, number>) => Promise<boolean>;
    emitFTMS: (payload: { flags: number; bytes: number[] }) => void;
  };
  __workoutService?: { startSession?: (routeId: string, routeName: string) => void };
};

async function connectFtms(page: Page) {
  await page.click('button:has-text("FTMS")');
  await page.click('button:has-text("Connect FTMS Rower")');

  await page.waitForFunction(() => {
    const containers = Array.from(document.querySelectorAll('.bluetooth-device-container'));
    const ftmsContainer = containers.find((c) => {
      const name = c.querySelector('.device-name');
      return name && String(name.textContent).includes('FTMS Rower');
    });
    if (!ftmsContainer) return false;
    const status = ftmsContainer.querySelector('.device-status');
    return status && String(status.textContent).includes('Connected');
  }, { timeout: 10_000 });
}

test.describe('FTMS rower device support', () => {
  test.beforeEach(async ({ page }) => {
    const initScript = fs.readFileSync(mockBluetoothPath, 'utf8');
    await page.addInitScript({ content: initScript });
    await page.goto('/');
  });

  test('device discovery: FTMS rower is selectable in the rower device panel', async ({ page }) => {
    await page.click('button:has-text("FTMS")');
    await expect(page.locator('button:has-text("Connect FTMS Rower")')).toBeVisible();
  });

  test('live metrics: SPM and split update from FTMS simulator within 500ms', async ({ page }) => {
    await connectFtms(page);

    await page.evaluate(() => {
      const simWindow = window as unknown as SimWindow;
      const bytes = [
        48, 0x01, 0x00, 48, 0x20, 0x03, 0x00, 0xe0, 0x2e, 0xe0, 0x2e,
        0xb4, 0x00, 0xb4, 0x00, 0x00, 0x00, 0x10, 0x00, 0x00, 0x00, 0x00,
        120, 8, 0x3c, 0x00, 0x00, 0x00,
      ];
      const buffer = new ArrayBuffer(2 + bytes.length);
      const view = new DataView(buffer);
      view.setUint16(0, 0x1ffe, true);
      bytes.forEach((b, i) => view.setUint8(i + 2, b));
      simWindow.__ftmsChar?._dispatch(view);
    });

    await expect(page.locator('.metric:has(.metric-label:has-text("Rate")) .metric-value')).toContainText('24', { timeout: 500 });
    await expect(page.locator('.metric:has(.metric-label:has-text("Pace")) .metric-value')).toContainText('120.0', { timeout: 500 });
  });

  test('long session: simulated 30-minute FTMS session completes with stable connection', async ({ page }) => {
    await connectFtms(page);

    await page.evaluate(async () => {
      const simWindow = window as unknown as SimWindow;
      await simWindow.__simulator?.startFtmsRoute('ftms-30min', {
        distance: 9000,
        step: 100,
        strokeRate: 24,
        pace: 12000,
        power: 190,
        elapsedStepSeconds: 20,
        msPerStep: 20,
      });
    });

    await page.waitForTimeout(6000);

    await expect(page.locator('.bluetooth-device-container:has(.device-name:has-text("FTMS Rower")) .device-status')).toContainText('Connected');
  });

  test('export validation: FIT export contains rowing activity type', async ({ page }) => {
    await connectFtms(page);

    await page.evaluate(() => {
      const svc = (window as unknown as SimWindow).__workoutService;
      if (svc?.startSession) {
        svc.startSession('ftms-sim-route', 'FTMS Sim Route');
      }
    });
    await expect(page.locator('.activity-view')).toBeVisible();

    await page.evaluate(async () => {
      (window as unknown as SimWindow).__simulator?.emitFTMS({
        flags: 0x1ffe,
        bytes: [
          48, 0x01, 0x00, 48, 0xf4, 0x01, 0x00, 0xe0, 0x2e, 0xe0, 0x2e, 0xb4, 0x00, 0xb4, 0x00, 0x00, 0x00,
          0x10, 0x00, 0x00, 0x00, 0x00, 120, 8, 0x3c, 0x00, 0x00, 0x00,
        ],
      });
    });

    await page.click('button:has-text("End Workout")');
    await page.click('button:has-text("History")');

    const downloadPromise = page.waitForEvent('download');
    await page.click('button:has-text("FIT")');
    const download = await downloadPromise;
    const downloadPath = await download.path();
    const fitData = JSON.parse(fs.readFileSync(downloadPath!, 'utf8'));

    expect(fitData?.session?.sport).toBe('rowing');
    expect(String(fitData?.session?.sub_sport ?? '').toLowerCase()).toContain('rowing');
    expect(JSON.stringify(fitData)).not.toContain('Cycling');
  });
});
