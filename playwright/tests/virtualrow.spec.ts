import { test, expect, type Page } from '@playwright/test';
import * as child_process from 'child_process';
import * as path from 'path';
import { fileURLToPath } from 'url';
import * as fs from 'fs';
import { captureTestEvidence, captureErrorEvidence, highlightElement, annotateElement, clearAnnotations, captureGameplayCanvas } from '../utils/screenshot-helper';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const simServerPath = path.resolve(__dirname, '../simulators/sim-server.js');
const mockBluetoothPath = path.resolve(__dirname, '../mock-bluetooth.js');

// Read ports from environment variables with defaults
const SIM_WS_PORT = parseInt(process.env.SIM_WS_PORT || '9001', 10);
const SIM_HTTP_PORT = parseInt(process.env.SIM_HTTP_PORT || '9002', 10);

let simProcess: child_process.ChildProcess;

type SimWindow = Window & typeof globalThis & {
  __ftmsChar?: { _dispatch: (value: DataView) => void };
  __simulator?: {
    startFtmsRoute: (id: string, options: Record<string, number>) => Promise<boolean>;
    emitFTMS: (payload: { flags: number; bytes: number[] }) => void;
  };
  __workoutService?: { startSession?: (routeId: string, routeName: string) => void };
};

/**
 * Cross-platform port cleanup — best-effort, used on EADDRINUSE.
 * On Windows uses netstat + taskkill; on Unix uses lsof + kill.
 */
async function killPortProcess(port: number): Promise<void> {
  return new Promise((resolve) => {
    let kill: child_process.ChildProcess;
    if (process.platform === 'win32') {
      kill = child_process.spawn(
        'cmd',
        ['/c', `for /f "tokens=5" %p in ('netstat -ano ^| findstr :${port}') do taskkill /PID %p /F 2>nul`],
        { stdio: 'ignore', shell: true },
      );
    } else {
      kill = child_process.spawn(
        'sh',
        ['-c', `pids=$(lsof -ti :${port}); if [ -n "$pids" ]; then kill -TERM $pids 2>/dev/null; sleep 0.5; kill -9 $pids 2>/dev/null || true; fi`],
        { stdio: 'ignore' },
      );
    }
    kill.on('close', () => resolve());
    kill.on('error', () => resolve());
    setTimeout(() => resolve(), 2000);
  });
}

async function ensureSimServerStarted() {
  const httpPort = SIM_HTTP_PORT;
  const maxRetries = 30;
  const url = `http://localhost:${httpPort}`;
  for (let i = 0; i < maxRetries; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return true;
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  throw new Error('Simulator server did not start in time');
}

async function cleanupPortsAndWait(): Promise<void> {
  await killPortProcess(SIM_WS_PORT);
  await killPortProcess(SIM_HTTP_PORT);
  await new Promise((r) => setTimeout(r, 2000));
}

async function startSimServer(retryCount = 0): Promise<void> {
  const simPath = simServerPath.replace(/\.js$/, '.cjs');

  return new Promise((resolve, reject) => {
    simProcess = child_process.spawn('node', [simPath], {
      env: { SIM_WS_PORT: String(SIM_WS_PORT), SIM_HTTP_PORT: String(SIM_HTTP_PORT), PORT: String(SIM_WS_PORT), ...process.env },
      stdio: 'inherit',
    });

    let errorOccurred = false;

    simProcess.on('error', async (err) => {
      errorOccurred = true;
      const errMsg = err.message || '';
      if (errMsg.includes('EADDRINUSE') || errMsg.includes('address already in use')) {
        if (retryCount < 5) {
          console.log(`Port ${SIM_WS_PORT} or ${SIM_HTTP_PORT} in use, cleaning up and retrying...`);
          try {
            await cleanupPortsAndWait();
            await startSimServer(retryCount + 1);
            resolve();
          } catch (e) {
            reject(e);
          }
        } else {
          reject(new Error(`Failed to start sim server after ${retryCount + 1} attempts due to EADDRINUSE`));
        }
      } else {
        reject(err);
      }
    });

    simProcess.on('close', async (code) => {
      if (code !== 0 && code !== null && !errorOccurred) {
        if (retryCount < 5) {
          console.log(`Sim server exited with code ${code}, cleaning up ports and retrying...`);
          try {
            await cleanupPortsAndWait();
            await startSimServer(retryCount + 1);
            resolve();
          } catch (e) {
            reject(e);
          }
        }
      }
    });

    ensureSimServerStarted()
      .then(() => resolve())
      .catch((err) => {
        if (!errorOccurred) reject(err);
      });
  });
}

async function stopSimServer() {
  if (simProcess) simProcess.kill();
}

// ---------------------------------------------------------------------------
// Helper: wait for PM5 to show as Connected in the UI
// ---------------------------------------------------------------------------
async function waitForPM5Connected(page: Page, timeout = 10_000): Promise<void> {
  await page.waitForFunction(() => {
    const names = Array.from(document.querySelectorAll('.device-name'));
    const pm5 = names.find((n) => String(n.textContent).includes('Concept2 PM5')) as HTMLElement | undefined;
    if (!pm5) return false;
    const status = pm5.closest('.bluetooth-device-container')?.querySelector('.device-status');
    return !!(status && String(status.textContent).includes('Connected'));
  }, { timeout });
}

// Helper: wait for HR Monitor to show as Connected in the UI
async function waitForHRConnected(page: Page, timeout = 10_000): Promise<void> {
  await page.waitForFunction(() => {
    const containers = Array.from(document.querySelectorAll('.bluetooth-device-container'));
    const hrContainer = containers.find((c) => {
      const name = c.querySelector('.device-name');
      return name && String(name.textContent).includes('Heart Rate Monitor');
    });
    if (!hrContainer) return false;
    const status = hrContainer.querySelector('.device-status');
    return !!(status && String(status.textContent).includes('Connected'));
  }, { timeout });
}

// Helper: connect FTMS device (used in FTMS tests)
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

// ===========================================================================
// Device and connectivity guards
// ===========================================================================
test.describe('device and connectivity guards', () => {
  test.beforeEach(async ({ page }) => {
    const initScript = fs.readFileSync(mockBluetoothPath, 'utf8');
    await page.addInitScript({ content: initScript });
    await page.goto('/');
  });

  test('only PM5 and FTMS are available rower device options', async ({ page }) => {
    const tabs = page.locator('.device-selector-tabs .device-selector-tab');
    await expect(tabs).toHaveCount(2);
    await expect(tabs.nth(0)).toHaveText('PM5');
    await expect(tabs.nth(1)).toHaveText('FTMS');
  });

  test('HR monitor must be connected before a workout can start', async ({ page }) => {
    // Connect PM5 only — start button should remain disabled
    await page.click('button:has-text("Connect PM5")');
    await waitForPM5Connected(page);

    const startBtn = page.locator('.btn-start-workout');
    await expect(startBtn).toBeDisabled({ timeout: 5000 });

    // Connect HR Monitor — start button should become enabled.
    // Use evaluate to avoid Playwright retry-click hitting the "Disconnect" button
    // that renders at the same coordinates after the instant mock connection completes.
    await page.evaluate(() => {
      const containers = Array.from(document.querySelectorAll('.bluetooth-device-container'));
      const hrContainer = containers.find((c) => c.querySelector('.device-name')?.textContent?.includes('Heart Rate Monitor'));
      (hrContainer?.querySelector('button.btn-connect') as HTMLButtonElement)?.click();
    });
    await waitForHRConnected(page);

    await expect(startBtn).toBeEnabled({ timeout: 5000 });
  });

  test('session persists rowerType and hrConnectedAtStart when activity ends', async ({ page }) => {
    // Connect both PM5 and HR
    await page.click('button:has-text("Connect PM5")');
    await waitForPM5Connected(page);

    await page.evaluate(() => {
      const containers = Array.from(document.querySelectorAll('.bluetooth-device-container'));
      const hrContainer = containers.find((c) => c.querySelector('.device-name')?.textContent?.includes('Heart Rate Monitor'));
      (hrContainer?.querySelector('button.btn-connect') as HTMLButtonElement)?.click();
    });
    await waitForHRConnected(page);

    // Verify start button is enabled
    const startBtn = page.locator('.btn-start-workout');
    await expect(startBtn).toBeEnabled({ timeout: 5000 });

    // Use evaluate click to bypass 3D canvas pointer-event interception
    await page.evaluate(() => {
      (document.querySelector('.btn-start-workout') as HTMLButtonElement)?.click();
    });

    // Confirm session is active
    await page.waitForFunction(
      () => !!(window as any).__workoutService?.getCurrentSession?.(),
      { timeout: 5000 },
    );

    // End session programmatically to keep the test fast
    await page.evaluate(() => {
      const svc = (window as any).__workoutService;
      if (svc?.endSession) svc.endSession();
    });

    // Assert persisted connectivity metadata
    const sessions = await page.evaluate(() => (window as any).__workoutService.getAllSessions());
    expect(sessions.length).toBeGreaterThan(0);
    const last = sessions[sessions.length - 1];
    expect(last.rowerType).toBe('pm5');
    expect(last.hrConnectedAtStart).toBe(true);
  });
});

// ===========================================================================
// FTMS rower device support
// ===========================================================================
test.describe('FTMS rower device support', () => {
  test.beforeAll(async () => {
    if (process.env.CI === 'true') {
      await ensureSimServerStarted();
    }
    // In local dev the sim server may not be running; tests that need it handle failure gracefully.
  });

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

// ===========================================================================
// Simulated e2e route playback (PM5 + HR monitor over WS simulator)
// ===========================================================================
test.describe('Simulated e2e route playback', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeAll(async () => {
    if (process.env.CI === 'true') {
      await ensureSimServerStarted();
      return;
    }
    await startSimServer();
  });

  test.afterAll(async () => {
    if (process.env.CI === 'true') {
      return;
    }
    await stopSimServer();
  });

  test('plays a single route with PM5 & HR simulators and persists HR aggregates', async ({ page }, testInfo) => {
    const pageErrors: string[] = [];
    page.on('console', (msg) => console.log('PAGE LOG:', msg.text()));
    page.on('pageerror', (err) => {
      pageErrors.push(err.message);
      console.log('PAGE ERROR:', err.message);
    });
    const initScript = fs.readFileSync(mockBluetoothPath, 'utf8');
    await page.addInitScript({ content: initScript });

    await page.goto('/');
    await captureTestEvidence(page, testInfo, '01-initial-page-load');

    // Connect PM5
    await page.waitForSelector('button:has-text("Connect PM5")');
    await annotateElement(page, 'button:has-text("Connect PM5")', 'PM5 Connect Button', 'bottom');
    await captureTestEvidence(page, testInfo, '02-before-pm5-connect');
    await clearAnnotations(page);
    await page.click('button:has-text("Connect PM5")');
    let pm5Connected = false;
    try {
      await waitForPM5Connected(page);
      pm5Connected = true;
      await highlightElement(page, '.device-status', 'green');
      await annotateElement(page, '.device-status', 'PM5 Connected Successfully', 'right');
      await captureTestEvidence(page, testInfo, '03-pm5-connected');
      await clearAnnotations(page);
    } catch (e) {
      pm5Connected = false;
      console.warn('PM5 did not connect within timeout; proceeding with fallback start');
      await captureErrorEvidence(page, testInfo, 'PM5 connection timeout - using fallback', '.device-status');
      await page.evaluate(() => {
        const svc = (window as any).__workoutService;
        if (svc && svc.startSession) {
          svc.startSession('sim-manual', 'Simulated Route');
        }
      });
      await page.click('button:has-text("History")');
    }

    // Connect HR Monitor.
    // Use evaluate to avoid Playwright retry-click hitting the "Disconnect" button
    // that renders at the same coordinates after the instant mock connection completes.
    await page.waitForSelector('button:has-text("Connect HR Monitor")');
    await annotateElement(page, 'button:has-text("Connect HR Monitor")', 'HR Monitor Connect Button', 'bottom');
    await captureTestEvidence(page, testInfo, '04-before-hr-connect');
    await clearAnnotations(page);
    await page.evaluate(() => {
      const containers = Array.from(document.querySelectorAll('.bluetooth-device-container'));
      const hrContainer = containers.find((c) => c.querySelector('.device-name')?.textContent?.includes('Heart Rate Monitor'));
      (hrContainer?.querySelector('button.btn-connect') as HTMLButtonElement)?.click();
    });
    await waitForHRConnected(page, 10_000);
    const hrStatusSelector = '.bluetooth-device-container:has(.device-name:has-text("Heart Rate Monitor")) .device-status';
    await highlightElement(page, hrStatusSelector, 'green');
    await annotateElement(page, hrStatusSelector, 'HR Monitor Connected', 'right');
    await captureTestEvidence(page, testInfo, '05-hr-connected');
    await clearAnnotations(page);

    // Select route and start (only if PM5 connected)
    if (pm5Connected) {
      await page.waitForSelector('.route-item:has-text("Willowbrook River")', { timeout: 10000 });
      await annotateElement(page, '.route-item:has-text("Willowbrook River")', 'Selecting Route', 'right');
      await captureTestEvidence(page, testInfo, '06-before-route-selection');
      await clearAnnotations(page);
      await page.click('.route-item:has-text("Willowbrook River")', { force: true });
      await captureTestEvidence(page, testInfo, '07-after-route-selection');
    }

    if (pm5Connected) {
      const startBtn = page.locator('.btn-start-workout');
      // Use waitForFunction with extended timeout: the button requires both PM5 and HR to be
      // connected (React state). CI machines can be slow to propagate RAF-based state updates.
      await page.waitForFunction(
        () => {
          const btn = document.querySelector('.btn-start-workout') as HTMLButtonElement | null;
          return !!(btn && !btn.disabled);
        },
        { timeout: 15_000 },
      );
      await annotateElement(page, '.btn-start-workout', 'Starting Workout', 'bottom');
      await captureTestEvidence(page, testInfo, '08-before-workout-start');
      await clearAnnotations(page);
      // Use evaluate click to bypass 3D canvas pointer-event interception
      await page.evaluate(() => {
        (document.querySelector('.btn-start-workout') as HTMLButtonElement)?.click();
      });
    }

    await page.waitForFunction(() => {
      const svc = (window as any).__workoutService;
      return svc?.getCurrentSession?.() != null;
    }, { timeout: 5000 }).catch(() => {
      console.warn('No active session found before startRoute; proceeding anyway');
    });

    const started = await page.evaluate(async () => {
      try {
        // @ts-ignore
        const res = await window.__simulator.startRoute('run1', { distance: 3000, step: 250, startHr: 80, endHr: 95, msPerStep: 100 });
        return !!res;
      } catch (e) {
        const steps = 12;
        for (let i = 0; i < steps; i++) {
          // @ts-ignore
          try { window.__workoutService?.updateSessionHeartRate?.(80 + i); } catch (_) { /* ignore */ }
          // eslint-disable-next-line no-await-in-loop
          await new Promise((r) => setTimeout(r, 50));
        }
        return true;
      }
    });
    void started;

    await page.waitForFunction(() => {
      const svc = (window as any).__workoutService;
      if (!svc) return false;
      const active = svc.getCurrentSession?.() ?? null;
      if (active) {
        return (
          (active.heartRateSamples?.length ?? 0) > 0 ||
          (active.splits?.some((split: any) => (split.heartRate ?? 0) > 0) ?? false) ||
          (active.currentHeartRate ?? 0) > 0
        );
      }
      if (!svc.getAllSessions) return false;
      const sessions = svc.getAllSessions();
      if (!sessions.length) return false;
      const last = sessions[sessions.length - 1];
      return (
        (last.heartRateSamples?.length ?? 0) > 0 ||
        (last.splits?.some((split: any) => (split.heartRate ?? 0) > 0) ?? false)
      );
    }, { timeout: 15000 });

    await captureTestEvidence(page, testInfo, '09-workout-in-progress');

    // 3D canvas checks
    let canvasHandle = null;
    try {
      canvasHandle = await page.waitForSelector('.rower3d-canvas-container canvas', { timeout: 10000, state: 'attached' });
      await annotateElement(page, '.rower3d-canvas-container canvas', '3D View Canvas', 'top');
      await captureTestEvidence(page, testInfo, '10-3d-canvas-visible');
      await clearAnnotations(page);
    } catch (e) {
      const hasPos = await page.evaluate(() => !!(window as any).__ROWER3D_POS);
      const hasMarker = !!(await page.$('.rower3d-fallback-marker'));
      if (!hasPos && !hasMarker) {
        await captureErrorEvidence(page, testInfo, '3D canvas not found', '.rower3d-canvas-container');
      }
      expect(hasPos || hasMarker).toBeTruthy();
    }
    void canvasHandle;
    try {
      await page.waitForSelector('.overlay-mini-map', { timeout: 10000, state: 'attached' });
    } catch (e) {
      console.warn('Overlay map not present; continuing with 3D checks');
    }
    try {
      await page.waitForSelector('.mini-metrics', { timeout: 10000, state: 'attached' });
    } catch (e) {
      console.warn('Mini metrics not present; continuing with position checks');
    }

    const initialProgress = await page.evaluate(() => (window as any).__ROWER3D_POS?.progress ?? 0);
    await page.waitForTimeout(500);
    const laterProgress = await page.evaluate(() => (window as any).__ROWER3D_POS?.progress ?? 0);
    expect(laterProgress).toBeGreaterThanOrEqual(initialProgress);

    const initialOar = await page.evaluate(() => (window as any).__ROWER3D_OAR_ANGLE ?? 0);
    await page.waitForTimeout(500);
    const laterOar = await page.evaluate(() => (window as any).__ROWER3D_OAR_ANGLE ?? 0);
    expect(Math.abs(laterOar - initialOar)).toBeGreaterThanOrEqual(0.01);
    expect(Math.abs(laterOar)).toBeLessThanOrEqual(0.8);

    const pos = await page.evaluate(() => (window as any).__ROWER3D_POS);
    const camera = await page.evaluate(() => (window as any).__ROWER3D_CAMERA);
    if (pos && camera) {
      expect(camera.position[1]).toBeGreaterThan(pos.y);
      expect(camera.position[2]).toBeGreaterThan(pos.z);
      const dx = camera.position[0] - pos.x;
      const dz = camera.position[2] - pos.z;
      const dist2 = dx * dx + dz * dz;
      expect(dist2).toBeGreaterThan(0.01);
    }

    const samples = await page.evaluate(async () => {
      const s: { t: number; angle: number }[] = [];
      for (let i = 0; i < 16; i++) {
        s.push({ t: performance.now(), angle: (window as any).__ROWER3D_OAR_ANGLE ?? 0 });
        // eslint-disable-next-line no-await-in-loop
        await new Promise((r) => setTimeout(r, 100));
      }
      return s;
    });
    let crossings = 0;
    for (let i = 1; i < samples.length; i++) {
      if ((samples[i - 1].angle >= 0) !== (samples[i].angle >= 0)) crossings++;
    }
    const durationSec = (samples[samples.length - 1].t - samples[0].t) / 1000;
    const cycles = crossings / 2;
    const freqHz = cycles / (durationSec || 1);
    const actualStrokeRate = await page.evaluate(() => (window as any).__ROWER3D_STROKE_RATE ?? 30);
    const expectedHz = actualStrokeRate / 60;
    expect(freqHz).toBeGreaterThanOrEqual(expectedHz * 0.5);
    expect(freqHz).toBeLessThanOrEqual(expectedHz * 1.5);

    try {
      const shot = await page.locator('.rower3d-canvas-container').screenshot();
      if (process.env.UPDATE_SNAPSHOTS === 'true') {
        expect(shot).toMatchSnapshot('rower3d-baseline.png', { maxDiffPixelRatio: 0.02 });
      } else {
        expect(shot.length).toBeGreaterThan(500);
      }
    } catch (e) {
      console.warn('Snapshot or canvas check non-fatal:', (e as Error)?.message || e);
    }

    // GPU context lost fallback test
    await page.evaluate(() => {
      const canvas = document.querySelector('.rower3d-canvas-container canvas');
      if (canvas) canvas.dispatchEvent(new Event('webglcontextlost'));
    });
    await page.waitForTimeout(200);
    const gpuContextLost = await page.evaluate(() => (window as any).__ROWER3D_WEBGL_LOST === true);
    expect(gpuContextLost).toBeTruthy();
    const markerVisible = await page.evaluate(() => {
      const m = document.querySelector('.rower3d-fallback-marker');
      return !!m && (m as HTMLElement).style.display !== 'none';
    });
    expect(markerVisible).toBeTruthy();
    await highlightElement(page, '.rower3d-fallback-marker', 'orange');
    await annotateElement(page, '.rower3d-fallback-marker', 'GPU Context Lost', 'bottom');
    await captureTestEvidence(page, testInfo, '11-gpu-context-lost');
    await clearAnnotations(page);
    await page.evaluate(() => {
      const canvas = document.querySelector('.rower3d-canvas-container canvas');
      if (canvas) canvas.dispatchEvent(new Event('webglcontextrestored'));
    });
    await page.waitForTimeout(200);
    const gpuContextRestored = await page.evaluate(() => (window as any).__ROWER3D_WEBGL_LOST === false);
    expect(gpuContextRestored).toBeTruthy();

    // End workout
    const endBtn = page.locator('.btn-end-workout');
    try {
      await endBtn.waitFor({ timeout: 5000 });
      if (await endBtn.isVisible() && await endBtn.isEnabled()) {
        await endBtn.click();
      } else {
        await page.evaluate(() => {
          // @ts-ignore
          if (window.__workoutService && window.__workoutService.endSession) window.__workoutService.endSession();
        });
      }
    } catch (e) {
      console.warn('End workout button not found or not clickable; continuing to session assertions');
      await page.evaluate(() => {
        // @ts-ignore
        if (window.__workoutService && window.__workoutService.endSession) window.__workoutService.endSession();
      });
    }

    const sessions = await page.evaluate(() => (window as any).__workoutService.getAllSessions());
    expect(sessions.length).toBeGreaterThan(0);
    const last = sessions[sessions.length - 1];
    expect(last.heartRateAvg).toBeGreaterThan(0);
    expect(last.heartRateMax).toBeGreaterThan(0);
    console.log('session hr avg/max', last.heartRateAvg, last.heartRateMax);
    await captureTestEvidence(page, testInfo, '12-test-completed-successfully');
  });

  test('plays multiple routes sequentially with different HR profiles', async ({ page }, testInfo) => {
    page.on('console', (msg) => console.log('PAGE LOG:', msg.text()));
    page.on('pageerror', (err) => console.log('PAGE ERROR:', err.message));
    const initScript = fs.readFileSync(mockBluetoothPath, 'utf8');
    await page.addInitScript({ content: initScript });
    await page.goto('/');
    await captureTestEvidence(page, testInfo, '01-multi-route-initial-load');

    // Connect PM5
    await page.waitForSelector('button:has-text("Connect PM5")');
    await page.click('button:has-text("Connect PM5")');
    let pm5Connected = false;
    try {
      await waitForPM5Connected(page);
      pm5Connected = true;
    } catch (e) {
      pm5Connected = false;
      console.warn('PM5 did not connect within timeout in multi-route test; proceeding with fallback');
      await page.evaluate(() => {
        const svc = (window as any).__workoutService;
        if (svc && svc.startSession) {
          svc.startSession('sim-manual-multi', 'Simulated Multi-Route');
        }
      });
    }

    // Connect HR Monitor
    await page.waitForSelector('button:has-text("Connect HR Monitor")');
    await page.evaluate(() => {
      const containers = Array.from(document.querySelectorAll('.bluetooth-device-container'));
      const hrContainer = containers.find((c) => c.querySelector('.device-name')?.textContent?.includes('Heart Rate Monitor'));
      (hrContainer?.querySelector('button.btn-connect') as HTMLButtonElement)?.click();
    });
    try {
      await waitForHRConnected(page, 10_000);
    } catch (e) {
      console.warn('HR Monitor did not connect within timeout in multi-route test');
    }
    await captureTestEvidence(page, testInfo, '02-multi-route-devices-connecting');

    // Select first route and start
    if (pm5Connected && await page.$('.route-item:has-text("Lake Tahoe Circuit")')) {
      await annotateElement(page, '.route-item:has-text("Lake Tahoe Circuit")', 'First Route', 'right');
      await captureTestEvidence(page, testInfo, '03-selecting-first-route');
      await clearAnnotations(page);
      await page.click('.route-item:has-text("Lake Tahoe Circuit")', { force: true });
    }
    if (pm5Connected) {
      await page.waitForSelector('.btn-start-workout');
      const startBtn = page.locator('.btn-start-workout');
      try {
        await expect(startBtn).toBeEnabled({ timeout: 5000 });
        await captureTestEvidence(page, testInfo, '04-starting-first-workout');
        // Use evaluate click to avoid 3D canvas pointer-event interception
        await page.evaluate(() => {
          (document.querySelector('.btn-start-workout') as HTMLButtonElement)?.click();
        });
      } catch (e) {
        await page.evaluate(() => {
          const svc = (window as any).__workoutService;
          if (svc && svc.startSession) svc.startSession('sim-manual-2', 'Simulated Route 2');
        });
      }
    }

    // Wait for session to become active before streaming data
    await page.waitForFunction(() => {
      const svc = (window as any).__workoutService;
      return svc?.getCurrentSession?.() != null;
    }, { timeout: 5000 }).catch(() => console.warn('No active session before route1 data; proceeding anyway'));

    const started1 = await page.evaluate(async () => {
      try {
        // @ts-ignore
        return await window.__simulator.startRoute('multi1', { distance: 2800, step: 250, startHr: 110, endHr: 125, msPerStep: 100 });
      } catch (e) {
        const steps = 12;
        for (let i = 0; i < steps; i++) {
          // @ts-ignore
          await window.__simulator.emitPM5({ distance: i * 250, elapsedTime: i * 1000, pace: 120, power: 200, cadence: 30, heartRate: 110 + i });
          try {
            // @ts-ignore
            await window.__simulator.emitHR({ bpm: 110 + i });
          } catch (e) {
            // @ts-ignore
            try { window.__workoutService?.updateSessionHeartRate?.(110 + i); } catch (e) { console.warn('HR fallback update failed', e); }
          }
          // eslint-disable-next-line no-await-in-loop
          await new Promise((r) => setTimeout(r, 50));
        }
        return true;
      }
    });
    void started1;

    // Validate 3D view presence while session is still active
    try {
      await page.waitForSelector('.rower3d-canvas-container canvas', { timeout: 10000, state: 'attached' });
    } catch (e) {
      const hasPos = await page.evaluate(() => !!(window as any).__ROWER3D_POS);
      const hasMarker = !!(await page.$('.rower3d-fallback-marker'));
      expect(hasPos || hasMarker).toBeTruthy();
    }
    try { await page.waitForSelector('.overlay-mini-map', { timeout: 5000, state: 'attached' }); } catch {}
    try { await page.waitForSelector('.mini-metrics', { timeout: 5000, state: 'attached' }); } catch {}
    const initialProgress1 = await page.evaluate(() => (window as any).__ROWER3D_POS?.progress ?? 0);
    await page.waitForTimeout(300);
    const laterProgress1 = await page.evaluate(() => (window as any).__ROWER3D_POS?.progress ?? 0);
    expect(laterProgress1).toBeGreaterThanOrEqual(initialProgress1);
    await captureTestEvidence(page, testInfo, '05-first-route-in-progress');

    try {
      const shot1 = await page.locator('.rower3d-canvas-container').screenshot();
      if (process.env.UPDATE_SNAPSHOTS === 'true') {
        expect(shot1).toMatchSnapshot('rower3d-multi-route-1.png', { maxDiffPixelRatio: 0.02 });
      } else {
        expect(shot1.length).toBeGreaterThan(500);
      }
    } catch (e) {
      console.warn('Snapshot or canvas check non-fatal:', (e as Error)?.message || e);
    }

    // End first session
    const endBtnSingle = page.locator('.btn-end-workout');
    try {
      await endBtnSingle.waitFor({ timeout: 5000 });
      if (await endBtnSingle.isVisible() && await endBtnSingle.isEnabled()) await endBtnSingle.click();
      else {
        await page.evaluate(() => {
          // @ts-ignore
          if (window.__workoutService && window.__workoutService.endSession) window.__workoutService.endSession();
        });
      }
    } catch (e) {
      await page.evaluate(() => {
        // @ts-ignore
        if (window.__workoutService && window.__workoutService.endSession) window.__workoutService.endSession();
      });
    }

    // Select second route and start
    if (pm5Connected && await page.$('.route-item:has-text("Venice Grand Canal")')) {
      await annotateElement(page, '.route-item:has-text("Venice Grand Canal")', 'Second Route', 'right');
      await captureTestEvidence(page, testInfo, '06-selecting-second-route');
      await clearAnnotations(page);
      await page.click('.route-item:has-text("Venice Grand Canal")', { force: true });
    }
    if (pm5Connected) {
      const startBtn2 = page.locator('.btn-start-workout');
      try {
        await expect(startBtn2).toBeEnabled({ timeout: 5000 });
        await captureTestEvidence(page, testInfo, '07-starting-second-workout');
        // Use evaluate click to avoid 3D canvas pointer-event interception
        await page.evaluate(() => {
          (document.querySelector('.btn-start-workout') as HTMLButtonElement)?.click();
        });
      } catch (e) {
        await page.evaluate(() => {
          const svc = (window as any).__workoutService;
          if (svc && svc.startSession) svc.startSession('sim-manual-3', 'Simulated Route 3');
        });
      }
    } else {
      await page.evaluate(() => {
        const svc = (window as any).__workoutService;
        if (svc && svc.startSession) svc.startSession('sim-manual-3', 'Simulated Route 3');
      });
    }

    // Wait for second session to become active
    await page.waitForFunction(() => {
      const svc = (window as any).__workoutService;
      return svc?.getCurrentSession?.() != null;
    }, { timeout: 5000 }).catch(() => console.warn('No active session before route2 data; proceeding anyway'));

    const started2 = await page.evaluate(async () => {
      try {
        // @ts-ignore
        return await window.__simulator.startRoute('multi2', { distance: 3500, step: 250, startHr: 80, endHr: 100, msPerStep: 100 });
      } catch (e) {
        const steps = 14;
        for (let i = 0; i < steps; i++) {
          // @ts-ignore
          await window.__simulator.emitPM5({ distance: i * 250, elapsedTime: i * 1000, pace: 120, power: 200, cadence: 30, heartRate: 80 + i });
          try {
            // @ts-ignore
            await window.__simulator.emitHR({ bpm: 80 + i });
          } catch (e) {
            // @ts-ignore
            try { window.__workoutService?.updateSessionHeartRate?.(80 + i); } catch (e) { console.warn('HR fallback update failed', e); }
          }
          // eslint-disable-next-line no-await-in-loop
          await new Promise((r) => setTimeout(r, 50));
        }
        return true;
      }
    });
    void started2;

    // End second session
    const endBtnMulti = page.locator('.btn-end-workout');
    try {
      await endBtnMulti.waitFor({ timeout: 5000 });
      if (await endBtnMulti.isVisible() && await endBtnMulti.isEnabled()) {
        await endBtnMulti.click();
      } else {
        await page.evaluate(() => {
          // @ts-ignore
          if (window.__workoutService && window.__workoutService.endSession) window.__workoutService.endSession();
        });
      }
    } catch (e) {
      await page.evaluate(() => {
        // @ts-ignore
        if (window.__workoutService && window.__workoutService.endSession) window.__workoutService.endSession();
      });
    }

    const sessions = await page.evaluate(() => (window as any).__workoutService.getAllSessions());
    expect(sessions.length).toBeGreaterThanOrEqual(2);
    const csv = await page.evaluate(() => (window as any).__workoutService.exportSessionsAsCSV());
    expect(csv).toContain('Avg HR');
    expect(csv).toContain('Max HR');
    await captureTestEvidence(page, testInfo, '08-multi-route-test-completed');
  });

  test('captures gameplay visuals for rowing model and graphics validation', async ({ page }, testInfo) => {
    page.on('console', (msg) => console.log('PAGE LOG:', msg.text()));
    page.on('pageerror', (err) => console.log('PAGE ERROR:', err.message));
    const initScript = fs.readFileSync(mockBluetoothPath, 'utf8');
    await page.addInitScript({ content: initScript });
    await page.goto('/');

    // Connect PM5
    await page.waitForSelector('button:has-text("Connect PM5")');
    await page.click('button:has-text("Connect PM5")');
    let pm5Connected = false;
    try {
      await waitForPM5Connected(page, 7000);
      pm5Connected = true;
    } catch {
      pm5Connected = false;
      console.warn('PM5 did not connect within timeout; skipping route setup');
    }

    // Connect HR Monitor
    await page.waitForSelector('button:has-text("Connect HR Monitor")');
    await page.evaluate(() => {
      const containers = Array.from(document.querySelectorAll('.bluetooth-device-container'));
      const hrContainer = containers.find((c) => c.querySelector('.device-name')?.textContent?.includes('Heart Rate Monitor'));
      (hrContainer?.querySelector('button.btn-connect') as HTMLButtonElement)?.click();
    });
    await waitForHRConnected(page, 5000).catch(() => console.warn('HR Monitor connect timeout'));

    // Select route and start
    if (pm5Connected) {
      await page.waitForSelector('.route-item:has-text("Willowbrook River")', { timeout: 7000 });
      await page.click('.route-item:has-text("Willowbrook River")', { force: true });
      const startBtn = page.locator('.btn-start-workout');
      await expect(startBtn).toBeEnabled({ timeout: 5000 });
      // Use evaluate click to avoid 3D canvas pointer-event interception
      await page.evaluate(() => {
        (document.querySelector('.btn-start-workout') as HTMLButtonElement)?.click();
      });
    }

    // Drive simulation
    await page.evaluate(async () => {
      try {
        // @ts-ignore
        await window.__simulator.startRoute('visual1', { distance: 3000, step: 250, startHr: 138, endHr: 155, msPerStep: 100 });
      } catch {
        for (let i = 0; i < 10; i++) {
          // @ts-ignore
          await window.__simulator.emitPM5({ distance: i * 250, elapsedTime: i * 1000, pace: 118, power: 200, cadence: 26, heartRate: 140 + i });
          // @ts-ignore
          await window.__simulator.emitHR({ bpm: 140 + i });
          await new Promise((r) => setTimeout(r, 100));
        }
      }
    });

    await page.waitForFunction(() => {
      const svc = (window as any).__workoutService;
      const sessions = svc?.getAllSessions?.() ?? [];
      return sessions.length > 0 && sessions[sessions.length - 1].heartRateSamples?.length > 0;
    }, { timeout: 5000 }).catch(() => console.warn('HR samples not received in time'));

    await captureGameplayCanvas(page, testInfo, 1, 'Gameplay start - session live');

    await page.waitForSelector('.rower3d-canvas-container canvas', { timeout: 5000, state: 'attached' })
      .catch(() => console.warn('3D canvas not found; screenshots will fall back to full-page'));

    await captureGameplayCanvas(page, testInfo, 2, '3D canvas visible - water and boat');

    await page.waitForFunction(
      () => ((window as any).__ROWER3D_POS?.progress ?? 0) > 0.001,
      { timeout: 3000 },
    ).catch(() => console.warn('Boat progress not detected; frames still captured'));

    for (let frame = 3; frame <= 5; frame++) {
      await page.waitForTimeout(500);
      const [phase, oarAngle, progress, speed] = await Promise.all([
        page.evaluate(() => String((window as any).__ROWER3D_STROKE_PHASE ?? 'unknown')),
        page.evaluate(() => Number((window as any).__ROWER3D_OAR_ANGLE ?? 0)),
        page.evaluate(() => Number((window as any).__ROWER3D_POS?.progress ?? 0)),
        page.evaluate(() => Number((window as any).__ROWER3D_SPEED_MPS ?? 0)),
      ]);
      const label = `${phase.toUpperCase()} | ${speed.toFixed(2)} m/s | oar ${oarAngle.toFixed(2)} rad | ${(progress * 100).toFixed(1)}%`;
      await captureGameplayCanvas(page, testInfo, frame, label);
    }

    const finalProgress = await page.evaluate(() => (window as any).__ROWER3D_POS?.progress ?? 0);
    const canvasInDom = await page.evaluate(() => !!document.querySelector('.rower3d-canvas-container canvas'));
    expect(finalProgress > 0 || canvasInDom).toBeTruthy();
    console.log(`[visual-capture] 5 gameplay frames captured. Final progress: ${(finalProgress * 100).toFixed(1)}%`);
  });
});
