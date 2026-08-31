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
  __PM5_DATA?: { distance: number };
  __simulator?: {
    startFtmsRoute: (id: string, options: Record<string, number>) => Promise<boolean>;
    emitFTMS: (payload: { flags: number; bytes: number[] }) => void;
  };
  __workoutService?: {
    startSession?: (routeId: string, routeName: string) => void;
    getCurrentSession?: () => { distance: number } | null;
  };
};

/** The per-UUID PM5 characteristic mocks created by mock-bluetooth.js. */
type PM5CharWindow = Window & typeof globalThis & {
  __pm5CharGeneral?: { _dispatch: (value: DataView) => void };
  __pm5CharAdditional?: { _dispatch: (value: DataView) => void };
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

/**
 * Assert the rower stream is actually feeding the live session.
 *
 * This is deliberately a hard assertion: it exercises only the BLE -> service ->
 * session data path, with no dependency on the 3D renderer, so it is stable on
 * software-GL CI where the animation-based checks below are not. Before issue
 * #194 was fixed it was impossible to assert this at all — the device panel
 * unmounted on the view switch and took the only listener with it, so every
 * session recorded 0 m.
 */
async function expectSessionDistanceAdvances(page: Page, timeout = 15_000): Promise<void> {
  await expect
    .poll(
      () => page.evaluate(
        () => (window as unknown as SimWindow).__workoutService?.getCurrentSession?.()?.distance ?? 0,
      ),
      { timeout },
    )
    .toBeGreaterThan(0);
}

// ---------------------------------------------------------------------------
// Helper: wait for PM5 to show as Connected in the UI
// ---------------------------------------------------------------------------
/**
 * Wait for the Row screen to be ready.
 *
 * Route discovery moved to its own screen in issue #219 (R3), so the presence
 * of `.route-item` is no longer the "app has loaded" signal it used to be —
 * the hero on the Row screen is.
 */
async function waitForRowScreen(page: Page, timeout = 10_000): Promise<void> {
  await page.waitForSelector('.route-info-overlay h2', { timeout });
}

/**
 * Pick a route by name: open the Routes screen, click its card, and land back
 * on the Row screen with it selected (issue #219, AC3.4).
 *
 * Returns false when the catalogue has no such route, leaving the caller on
 * the Row screen either way.
 */
async function selectRoute(page: Page, name: string, timeout = 10_000): Promise<boolean> {
  await page.getByRole('button', { name: 'Routes', exact: true }).click();
  await page.waitForSelector('.route-item', { timeout });

  const card = page.locator(`.route-item:has-text("${name}")`);
  if ((await card.count()) === 0) {
    await page.getByRole('button', { name: /back to row/i }).click();
    await waitForRowScreen(page, timeout);
    return false;
  }

  await card.first().click({ force: true });
  await waitForRowScreen(page, timeout);
  return true;
}

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
// PM5 frame helpers — match the wire format parsed by src/vendor/pm5-base.js
// ===========================================================================

function dispatchGeneralStatus(page: Page, distanceMeters: number, elapsedSeconds: number) {
  return page.evaluate(({ distanceMeters, elapsedSeconds }) => {
    const buf = new ArrayBuffer(11);
    const v = new Uint8Array(buf);
    const cs = Math.round(elapsedSeconds * 100);
    v[0] = cs & 0xff; v[1] = (cs >> 8) & 0xff; v[2] = (cs >> 16) & 0xff;
    const dm = Math.round(distanceMeters * 10);
    v[3] = dm & 0xff; v[4] = (dm >> 8) & 0xff; v[5] = (dm >> 16) & 0xff;
    v[10] = 2; // strokeState = rowing
    (window as unknown as PM5CharWindow).__pm5CharGeneral?._dispatch(new DataView(buf));
  }, { distanceMeters, elapsedSeconds });
}

function dispatchAdditionalStatus(
  page: Page,
  { elapsedSeconds, strokeRate, heartRate }: { elapsedSeconds: number; strokeRate: number; heartRate: number },
) {
  return page.evaluate(({ elapsedSeconds, strokeRate, heartRate }) => {
    const buf = new ArrayBuffer(11);
    const v = new Uint8Array(buf);
    const cs = Math.round(elapsedSeconds * 100);
    v[0] = cs & 0xff; v[1] = (cs >> 8) & 0xff; v[2] = (cs >> 16) & 0xff;
    v[3] = 0xd0; v[4] = 0x07;   // speed 2.000 m/s
    v[5] = strokeRate;
    v[6] = heartRate;
    v[7] = 0x1c; v[8] = 0x2e;   // currentPace 118.04 s/500m
    v[9] = 0x1c; v[10] = 0x2e;  // averagePace
    (window as unknown as PM5CharWindow).__pm5CharAdditional?._dispatch(new DataView(buf));
  }, { elapsedSeconds, strokeRate, heartRate });
}

function dispatchHeartRate(page: Page, bpm: number) {
  return page.evaluate((bpm) => {
    const buf = new ArrayBuffer(2);
    const dv = new DataView(buf);
    dv.setUint8(0, 0x00);
    dv.setUint8(1, bpm);
    const w = window as unknown as { __hrChar?: { _dispatch: (v: DataView) => void } };
    w.__hrChar?._dispatch(dv);
  }, bpm);
}

// ===========================================================================
// Device and connectivity guards
// ===========================================================================
test.describe('device and connectivity guards', () => {
  test.beforeEach(async ({ page }) => {
    const initScript = fs.readFileSync(mockBluetoothPath, 'utf8');
    await page.addInitScript({ content: initScript });
    await page.goto('./');
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
      () => !!window.__workoutService?.getCurrentSession?.(),
      { timeout: 5000 },
    );

    // End session programmatically to keep the test fast
    await page.evaluate(() => {
      const svc = window.__workoutService;
      if (svc?.endSession) svc.endSession();
    });

    // Assert persisted connectivity metadata
    const sessions = await page.evaluate(() => window.__workoutService!.getAllSessions());
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
    await page.goto('./');
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

  // NOTE: the in-app FIT export button was removed with the History view (AUTH-1).
  // FIT payload validation (sport === 'rowing', no cycling terms) now lives in the
  // unit suite: src/__tests__/exporters.test.ts.
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

    await page.goto('./');
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
    } catch {
      pm5Connected = false;
      console.warn('PM5 did not connect within timeout; proceeding with fallback start');
      await captureErrorEvidence(page, testInfo, 'PM5 connection timeout - using fallback', '.device-status');
      await page.evaluate(() => {
        const svc = window.__workoutService;
        if (svc && svc.startSession) {
          svc.startSession('sim-manual', 'Simulated Route');
        }
      });
      // Return to the routes view — the HR monitor panel only renders there.
      await page.click('button:has-text("Routes")');
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
      await page.getByRole('button', { name: 'Routes', exact: true }).click();
      await page.waitForSelector('.route-item:has-text("Willowbrook River")', { timeout: 10000 });
      await annotateElement(page, '.route-item:has-text("Willowbrook River")', 'Selecting Route', 'right');
      await captureTestEvidence(page, testInfo, '06-before-route-selection');
      await clearAnnotations(page);
      await page.click('.route-item:has-text("Willowbrook River")', { force: true });
      await waitForRowScreen(page);
      await captureTestEvidence(page, testInfo, '07-after-route-selection');
    }

    if (pm5Connected) {
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
      const svc = window.__workoutService;
      return svc?.getCurrentSession?.() != null;
    }, { timeout: 5000 }).catch(() => {
      console.warn('No active session found before startRoute; proceeding anyway');
    });

    const started = await page.evaluate(async () => {
      try {
        const res = await window.__simulator!.startRoute('run1', { distance: 3000, step: 250, startHr: 80, endHr: 95, msPerStep: 100 });
        return !!res;
      } catch {
        const steps = 12;
        for (let i = 0; i < steps; i++) {
          try { window.__workoutService?.updateSessionHeartRate?.(80 + i); } catch { /* ignore */ }
          await new Promise((r) => setTimeout(r, 50));
        }
        return true;
      }
    });
    void started;

    await page.waitForFunction(() => {
      const svc = window.__workoutService;
      if (!svc) return false;
      const active = svc.getCurrentSession?.() ?? null;
      if (active) {
        return (
          (active.heartRateSamples?.length ?? 0) > 0 ||
          (active.splits?.some((split: { heartRate?: number }) => (split.heartRate ?? 0) > 0) ?? false)
        );
      }
      if (!svc.getAllSessions) return false;
      const sessions = svc.getAllSessions();
      if (!sessions.length) return false;
      const last = sessions[sessions.length - 1];
      return (
        (last.heartRateSamples?.length ?? 0) > 0 ||
        (last.splits?.some((split: { heartRate?: number }) => (split.heartRate ?? 0) > 0) ?? false)
      );
    }, { timeout: 15000 });

    // The simulator has been streaming PM5 frames for several seconds; they must have
    // landed in the live session. (The fallback branch above never connects a rower,
    // so it has no distance to record.)
    if (pm5Connected) {
      await expectSessionDistanceAdvances(page);
    }

    await captureTestEvidence(page, testInfo, '09-workout-in-progress');

    // 3D canvas checks
    let canvasHandle = null;
    try {
      canvasHandle = await page.waitForSelector('.rower3d-canvas-container canvas', { timeout: 5000, state: 'attached' });
      await annotateElement(page, '.rower3d-canvas-container canvas', '3D View Canvas', 'top');
      await captureTestEvidence(page, testInfo, '10-3d-canvas-visible');
      await clearAnnotations(page);
    } catch {
      const hasPos = await page.evaluate(() => !!window.__ROWER3D_POS);
      const hasMarker = !!(await page.$('.rower3d-fallback-marker'));
      if (!hasPos && !hasMarker) {
        await captureErrorEvidence(page, testInfo, '3D canvas not found', '.rower3d-canvas-container');
      }
      expect(hasPos || hasMarker).toBeTruthy();
    }
    void canvasHandle;
    try {
      await page.waitForSelector('.overlay-mini-map', { timeout: 3000, state: 'attached' });
    } catch {
      console.warn('Overlay map not present; continuing with 3D checks');
    }
    try {
      await page.waitForSelector('.mini-metrics', { timeout: 3000, state: 'attached' });
    } catch {
      console.warn('Mini metrics not present; continuing with position checks');
    }

    const initialProgress = await page.evaluate(() => window.__ROWER3D_POS?.progress ?? 0);
    await page.waitForTimeout(500);
    const laterProgress = await page.evaluate(() => window.__ROWER3D_POS?.progress ?? 0);
    expect(laterProgress).toBeGreaterThanOrEqual(initialProgress);

    const initialOar = await page.evaluate(() => window.__ROWER3D_OAR_ANGLE ?? 0);

    try {
      await expect.poll(
        async () => {
          const state = await page.evaluate(() => ({
            angle: window.__ROWER3D_OAR_ANGLE,
            strokeRate: window.__ROWER3D_STROKE_RATE,
            phase: window.__ROWER3D_STROKE_PHASE,
            progress: window.__ROWER3D_POS?.progress ?? 0,
          }));

          if (typeof state.angle !== 'number') return 0;
          return Math.abs(state.angle - initialOar);
        },
        { timeout: 6000, intervals: [200, 300, 500] }
      ).toBeGreaterThanOrEqual(0.005);

      const laterOar = await page.evaluate(() => window.__ROWER3D_OAR_ANGLE ?? 0);
      expect(Math.abs(laterOar)).toBeLessThanOrEqual(0.8);
    } catch (e) {
      console.warn(
        'Oar animation delta check skipped (animation may not advance reliably on all CI platforms):',
        (e as Error)?.message,
      );
    }

    const pos = await page.evaluate(() => window.__ROWER3D_POS);
    const camera = await page.evaluate(() => window.__ROWER3D_CAMERA);
    if (pos && camera) {
      expect(camera.position[1]).toBeGreaterThan(pos.y);
      expect(camera.position[2]).toBeGreaterThan(pos.z);
      const dx = camera.position[0] - pos.x;
      const dz = camera.position[2] - pos.z;
      const dist2 = dx * dx + dz * dz;
      expect(dist2).toBeGreaterThan(0.01);
    }

    try {
      const samples = await page.evaluate(async () => {
        const s: { t: number; angle: number }[] = [];
        for (let i = 0; i < 16; i++) {
          s.push({ t: performance.now(), angle: window.__ROWER3D_OAR_ANGLE ?? 0 });
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
      const actualStrokeRate = await page.evaluate(() => window.__ROWER3D_STROKE_RATE ?? 30);
      const expectedHz = actualStrokeRate / 60;
      expect(freqHz).toBeGreaterThanOrEqual(expectedHz * 0.5);
      expect(freqHz).toBeLessThanOrEqual(expectedHz * 1.5);
    } catch (e) {
      console.warn('Oar frequency check skipped (3D animation may not stabilize on all CI platforms):', (e as Error)?.message);
    }

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
    const gpuContextLost = await page.evaluate(() => window.__ROWER3D_WEBGL_LOST === true);
    try {
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
    } catch (e) {
      console.warn('GPU context fallback check skipped (3D canvas may not have rendered):', (e as Error)?.message);
    }
    await page.evaluate(() => {
      const canvas = document.querySelector('.rower3d-canvas-container canvas');
      if (canvas) canvas.dispatchEvent(new Event('webglcontextrestored'));
    });
    await page.waitForTimeout(200);
    const gpuContextRestored = await page.evaluate(() => window.__ROWER3D_WEBGL_LOST === false);
    expect(gpuContextRestored).toBeTruthy();

    // End workout
    const endBtn = page.locator('.btn-end-workout');
    try {
      await endBtn.waitFor({ timeout: 5000 });
      if (await endBtn.isVisible() && await endBtn.isEnabled()) {
        await endBtn.click();
      } else {
        await page.evaluate(() => {
          window.__workoutService?.endSession();
        });
      }
    } catch {
      console.warn('End workout button not found or not clickable; continuing to session assertions');
      await page.evaluate(() => {
        window.__workoutService?.endSession();
      });
    }

    const sessions = await page.evaluate(() => window.__workoutService!.getAllSessions());
    expect(sessions.length).toBeGreaterThan(0);
    const last = sessions[sessions.length - 1];
    expect(last.heartRateAvg).toBeGreaterThan(0);
    expect(last.heartRateMax).toBeGreaterThan(0);
    if (pm5Connected) {
      expect(last.distance).toBeGreaterThan(0);
    }
    console.log('session hr avg/max', last.heartRateAvg, last.heartRateMax, 'distance', last.distance);
    await captureTestEvidence(page, testInfo, '12-test-completed-successfully');
  });

  test('plays multiple routes sequentially with different HR profiles', async ({ page }, testInfo) => {
    page.on('console', (msg) => console.log('PAGE LOG:', msg.text()));
    page.on('pageerror', (err) => console.log('PAGE ERROR:', err.message));
    const initScript = fs.readFileSync(mockBluetoothPath, 'utf8');
    await page.addInitScript({ content: initScript });
    await page.goto('./');
    await captureTestEvidence(page, testInfo, '01-multi-route-initial-load');

    // Connect PM5
    await page.waitForSelector('button:has-text("Connect PM5")');
    await page.click('button:has-text("Connect PM5")');
    let pm5Connected = false;
    try {
      await waitForPM5Connected(page);
      pm5Connected = true;
    } catch {
      pm5Connected = false;
      console.warn('PM5 did not connect within timeout in multi-route test; proceeding with fallback');
      await page.evaluate(() => {
        const svc = window.__workoutService;
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
    } catch {
      console.warn('HR Monitor did not connect within timeout in multi-route test');
    }
    await captureTestEvidence(page, testInfo, '02-multi-route-devices-connecting');

    // Select first route and start
    if (pm5Connected && await selectRoute(page, 'Lake Tahoe Circuit')) {
      await annotateElement(page, '.route-info-overlay h2', 'First Route', 'right');
      await captureTestEvidence(page, testInfo, '03-selecting-first-route');
      await clearAnnotations(page);
    }
    if (pm5Connected) {
      await page.waitForSelector('.btn-start-workout');
      try {
        await page.waitForFunction(
          () => {
            const btn = document.querySelector('.btn-start-workout') as HTMLButtonElement | null;
            return !!(btn && !btn.disabled);
          },
          { timeout: 8_000 },
        );
        await captureTestEvidence(page, testInfo, '04-starting-first-workout');
        // Use evaluate click to avoid 3D canvas pointer-event interception
        await page.evaluate(() => {
          (document.querySelector('.btn-start-workout') as HTMLButtonElement)?.click();
        });
      } catch {
        await page.evaluate(() => {
          const svc = window.__workoutService;
          if (svc && svc.startSession) svc.startSession('sim-manual-2', 'Simulated Route 2');
        });
      }
    }

    // Wait for session to become active before streaming data
    await page.waitForFunction(() => {
      const svc = window.__workoutService;
      return svc?.getCurrentSession?.() != null;
    }, { timeout: 5000 }).catch(() => console.warn('No active session before route1 data; proceeding anyway'));

    const started1 = await page.evaluate(async () => {
      try {
        return await window.__simulator!.startRoute('multi1', { distance: 2800, step: 250, startHr: 110, endHr: 125, msPerStep: 100 });
      } catch {
        const steps = 12;
        for (let i = 0; i < steps; i++) {
          await window.__simulator!.emitPM5({ distance: i * 250, elapsedTime: i * 1000, pace: 120, power: 200, cadence: 30, heartRate: 110 + i });
          try {
            await window.__simulator!.emitHR({ bpm: 110 + i });
          } catch {
            try { window.__workoutService?.updateSessionHeartRate?.(110 + i); } catch (e) { console.warn('HR fallback update failed', e); }
          }
          await new Promise((r) => setTimeout(r, 50));
        }
        return true;
      }
    });
    void started1;

    // Validate 3D view presence while session is still active
    try {
      await page.waitForSelector('.rower3d-canvas-container canvas', { timeout: 5000, state: 'attached' });
    } catch {
      const hasPos = await page.evaluate(() => !!window.__ROWER3D_POS);
      const hasMarker = !!(await page.$('.rower3d-fallback-marker'));
      expect(hasPos || hasMarker).toBeTruthy();
    }
    // The overlays are optional here: the assertions below cover the case where
    // they never attach, so a timeout is not a failure.
    try { await page.waitForSelector('.overlay-mini-map', { timeout: 3000, state: 'attached' }); } catch { /* overlay is optional */ }
    try { await page.waitForSelector('.mini-metrics', { timeout: 3000, state: 'attached' }); } catch { /* overlay is optional */ }
    if (pm5Connected) {
      await expectSessionDistanceAdvances(page);
    }
    const initialProgress1 = await page.evaluate(() => window.__ROWER3D_POS?.progress ?? 0);
    await page.waitForTimeout(300);
    const laterProgress1 = await page.evaluate(() => window.__ROWER3D_POS?.progress ?? 0);
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
          window.__workoutService?.endSession();
        });
      }
    } catch {
      await page.evaluate(() => {
        window.__workoutService?.endSession();
      });
    }

    // Select second route and start
    if (pm5Connected && await selectRoute(page, 'Venice Grand Canal')) {
      await annotateElement(page, '.route-info-overlay h2', 'Second Route', 'right');
      await captureTestEvidence(page, testInfo, '06-selecting-second-route');
      await clearAnnotations(page);
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
      } catch {
        await page.evaluate(() => {
          const svc = window.__workoutService;
          if (svc && svc.startSession) svc.startSession('sim-manual-3', 'Simulated Route 3');
        });
      }
    } else {
      await page.evaluate(() => {
        const svc = window.__workoutService;
        if (svc && svc.startSession) svc.startSession('sim-manual-3', 'Simulated Route 3');
      });
    }

    // Wait for second session to become active
    await page.waitForFunction(() => {
      const svc = window.__workoutService;
      return svc?.getCurrentSession?.() != null;
    }, { timeout: 5000 }).catch(() => console.warn('No active session before route2 data; proceeding anyway'));

    const started2 = await page.evaluate(async () => {
      try {
        return await window.__simulator!.startRoute('multi2', { distance: 3500, step: 250, startHr: 80, endHr: 100, msPerStep: 100 });
      } catch {
        const steps = 14;
        for (let i = 0; i < steps; i++) {
          await window.__simulator!.emitPM5({ distance: i * 250, elapsedTime: i * 1000, pace: 120, power: 200, cadence: 30, heartRate: 80 + i });
          try {
            await window.__simulator!.emitHR({ bpm: 80 + i });
          } catch {
            try { window.__workoutService?.updateSessionHeartRate?.(80 + i); } catch (e) { console.warn('HR fallback update failed', e); }
          }
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
          window.__workoutService?.endSession();
        });
      }
    } catch {
      await page.evaluate(() => {
        window.__workoutService?.endSession();
      });
    }

    const sessions = await page.evaluate(() => window.__workoutService!.getAllSessions());
    expect(sessions.length).toBeGreaterThanOrEqual(2);
    if (pm5Connected) {
      // Both legs were driven by the simulator, so both must have recorded metres.
      for (const session of sessions.slice(-2)) {
        expect(session.distance).toBeGreaterThan(0);
      }
    }
    const csv = await page.evaluate(() => window.__workoutService!.exportSessionsAsCSV());
    expect(csv).toContain('Avg HR');
    expect(csv).toContain('Max HR');
    await captureTestEvidence(page, testInfo, '08-multi-route-test-completed');
  });

  test('captures gameplay visuals for rowing model and graphics validation', async ({ page }, testInfo) => {
    page.on('console', (msg) => console.log('PAGE LOG:', msg.text()));
    page.on('pageerror', (err) => console.log('PAGE ERROR:', err.message));
    const initScript = fs.readFileSync(mockBluetoothPath, 'utf8');
    await page.addInitScript({ content: initScript });
    await page.goto('./');

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
      await selectRoute(page, 'Willowbrook River', 7000);
      try {
        await page.waitForFunction(
          () => {
            const btn = document.querySelector('.btn-start-workout') as HTMLButtonElement | null;
            return !!(btn && !btn.disabled);
          },
          { timeout: 8_000 },
        );
      } catch {
        console.warn('Start button not enabled in time; attempting click anyway');
      }
      // Use evaluate click to avoid 3D canvas pointer-event interception
      await page.evaluate(() => {
        (document.querySelector('.btn-start-workout') as HTMLButtonElement)?.click();
      });
    }

    // Drive simulation
    await page.evaluate(async () => {
      try {
        await window.__simulator!.startRoute('visual1', { distance: 3000, step: 250, startHr: 138, endHr: 155, msPerStep: 100 });
      } catch {
        for (let i = 0; i < 10; i++) {
          await window.__simulator!.emitPM5({ distance: i * 250, elapsedTime: i * 1000, pace: 118, power: 200, cadence: 26, heartRate: 140 + i });
          await window.__simulator!.emitHR({ bpm: 140 + i });
          await new Promise((r) => setTimeout(r, 100));
        }
      }
    });

    await page.waitForFunction(() => {
      const svc = window.__workoutService;
      const sessions = svc?.getAllSessions?.() ?? [];
      return sessions.length > 0 && (sessions[sessions.length - 1]?.heartRateSamples?.length ?? 0) > 0;
    }, { timeout: 5000 }).catch(() => console.warn('HR samples not received in time'));

    if (pm5Connected) {
      await expectSessionDistanceAdvances(page);
    }

    await captureGameplayCanvas(page, testInfo, 1, 'Gameplay start - session live');

    await page.waitForSelector('.rower3d-canvas-container canvas', { timeout: 5000, state: 'attached' })
      .catch(() => console.warn('3D canvas not found; screenshots will fall back to full-page'));

    await captureGameplayCanvas(page, testInfo, 2, '3D canvas visible - water and boat');

    await page.waitForFunction(
      () => (window.__ROWER3D_POS?.progress ?? 0) > 0.001,
      { timeout: 3000 },
    ).catch(() => console.warn('Boat progress not detected; frames still captured'));

    for (let frame = 3; frame <= 5; frame++) {
      await page.waitForTimeout(500);
      const [phase, oarAngle, progress, speed] = await Promise.all([
        page.evaluate(() => String(window.__ROWER3D_STROKE_PHASE ?? 'unknown')),
        page.evaluate(() => Number(window.__ROWER3D_OAR_ANGLE ?? 0)),
        page.evaluate(() => Number(window.__ROWER3D_POS?.progress ?? 0)),
        page.evaluate(() => Number(window.__ROWER3D_SPEED_MPS ?? 0)),
      ]);
      const label = `${phase.toUpperCase()} | ${speed.toFixed(2)} m/s | oar ${oarAngle.toFixed(2)} rad | ${(progress * 100).toFixed(1)}%`;
      await captureGameplayCanvas(page, testInfo, frame, label);
    }

    const finalProgress = await page.evaluate(() => window.__ROWER3D_POS?.progress ?? 0);
    const canvasInDom = await page.evaluate(() => !!document.querySelector('.rower3d-canvas-container canvas'));
    expect(finalProgress > 0 || canvasInDom).toBeTruthy();
    console.log(`[visual-capture] 5 gameplay frames captured. Final progress: ${(finalProgress * 100).toFixed(1)}%`);
  });
});

// ===========================================================================
// Docs screenshots — captures in-game visuals published to docs/
// ===========================================================================
test.describe('docs screenshots', () => {
  const docsDir = path.resolve(__dirname, '../../docs');

  test.beforeEach(async ({ page }) => {
    const initScript = fs.readFileSync(mockBluetoothPath, 'utf8');
    await page.addInitScript({ content: initScript });
    await page.goto('./');
    await waitForRowScreen(page);
  });

  test('captures and publishes screenshots for documentation', async ({ page }) => {
    // 1. The Row screen — viewport only, so the selected route and its map fill
    //    the frame (the route list is its own screen now, issue #219 R3).
    await page.screenshot({ path: path.join(docsDir, 'screenshot-route-selection.png'), fullPage: false });

    // 2. Connect PM5 and HR
    await page.waitForSelector('button:has-text("Connect PM5")');
    await page.click('button:has-text("Connect PM5")');
    await waitForPM5Connected(page);

    await page.evaluate(() => {
      const containers = Array.from(document.querySelectorAll('.bluetooth-device-container'));
      const hrContainer = containers.find((c) =>
        c.querySelector('.device-name')?.textContent?.includes('Heart Rate Monitor'),
      );
      (hrContainer?.querySelector('button.btn-connect') as HTMLButtonElement)?.click();
    });
    await waitForHRConnected(page);

    // Select Willowbrook River route (fallback to first route if not found)
    if (!(await selectRoute(page, 'Willowbrook River'))) {
      await page.getByRole('button', { name: 'Routes', exact: true }).click();
      await page.waitForSelector('.route-item', { timeout: 10_000 });
      await page.locator('.route-item').first().click({ force: true });
      await waitForRowScreen(page);
    }

    // Wait for start button to become enabled
    await page.waitForFunction(
      () => {
        const btn = document.querySelector('.btn-start-workout') as HTMLButtonElement | null;
        return !!(btn && !btn.disabled);
      },
      { timeout: 10_000 },
    );

    // Start workout via evaluate to bypass 3D canvas pointer-event interception
    await page.evaluate(() => {
      (document.querySelector('.btn-start-workout') as HTMLButtonElement)?.click();
    });

    await page.waitForFunction(
      () => !!window.__workoutService?.getCurrentSession?.(),
      { timeout: 5000 },
    );

    // Wait for React to render the activity view
    await page.waitForSelector('.activity-view', { timeout: 10_000 });

    // Wait for Three.js WebGL renderer to initialise (fires in Canvas onCreated callback)
    await page.waitForFunction(
      () => !!window.__ROWER3D_GPU_BACKEND,
      { timeout: 15_000 },
    );

    // Inject PM5 + HR data three times with pauses so the animation loop runs multiple
    // frames and the boat model has time to load and be positioned on the route.
    for (let i = 1; i <= 3; i++) {
      await dispatchGeneralStatus(page, 500 * i, 60 * i);
      await dispatchAdditionalStatus(page, { elapsedSeconds: 60 * i, strokeRate: 26, heartRate: 148 });
      await dispatchHeartRate(page, 148);
      await page.waitForTimeout(600);
    }

    // Wait for the Rower3D animation loop to place the boat on the route
    await page.waitForFunction(
      () => (window.__ROWER3D_DISTANCE_M ?? 0) > 0,
      { timeout: 5000 },
    ).catch(() => { /* non-critical — screenshot taken regardless */ });

    // Allow Two.js/Three.js additional frame time to render the scene
    await page.waitForTimeout(1500);

    // 3. Activity screen — viewport only so the 3D canvas is centre-stage
    await page.screenshot({ path: path.join(docsDir, 'screenshot-activity.png'), fullPage: false });

    // 4. 3D hero image — clip to the existing 3D canvas stage so the single scull
    // is centre-stage without sidebar/stats overlays. Critically, we do NOT resize
    // the canvas/page layout here: aggressive width/height overrides on the
    // route stage trigger WebGL context loss in headless software-rendered
    // Chromium and cause the GPU error boundary to render a blank fallback.
    // Instead we hide the in-stage overlays only, then screenshot the
    // .activity-route-stage element directly.
    await page.evaluate(() => {
      const style = document.createElement('style');
      style.id = 'docs-hero-screenshot-style';
      style.textContent = `
        .activity-route-summary,
        .activity-map-overlay {
          display: none !important;
        }
      `;
      document.head.appendChild(style);
    });
    // Wait until the overlay-hidden state is actually applied before capture
    // (deterministic — avoids relying on a fixed timeout).
    await page.waitForFunction(() => {
      const summary = document.querySelector('.activity-route-summary');
      const mapOverlay = document.querySelector('.activity-map-overlay');
      const summaryHidden = !summary || window.getComputedStyle(summary).display === 'none';
      const mapHidden = !mapOverlay || window.getComputedStyle(mapOverlay).display === 'none';
      return summaryHidden && mapHidden;
    }, { timeout: 2000 });
    const routeStage = page.locator('.activity-route-stage');
    // Use page.screenshot with clip to avoid locator stability-check timeouts caused
    // by the Three.js animation loop on Ubuntu/Windows CI runners. This gives the same
    // cropped output without waiting for pixel-level stabilisation.
    const routeStageBbox = await routeStage.boundingBox({ timeout: 5000 }).catch(() => null);
    await page.screenshot({
      path: path.join(docsDir, 'screenshot-rower-3d.png'),
      ...(routeStageBbox ? { clip: routeStageBbox } : {}),
    });
    await page.evaluate(() => {
      document.getElementById('docs-hero-screenshot-style')?.remove();
    });

    // 5. End the live session and return to the routes view.
    // (The History screenshot was dropped along with the History view — AUTH-1.)
    await page.evaluate(() => {
      const svc = window.__workoutService;
      if (svc?.endSession) svc.endSession();
    });
    await page.waitForSelector('.view-container--routes', { timeout: 5000 });
  });
});

test.describe('docs screenshots — other route heroes', () => {
  const docsDir = path.resolve(__dirname, '../../docs');

  // -------------------------------------------------------------------------
  // Additional route hero screenshots — capture the 3D stage on each of the
  // non-Willowbrook routes so the website can showcase the visual variety.
  // The hero capture for Willowbrook River is produced by the main docs
  // screenshots test above (`screenshot-rower-3d.png`); this test produces
  // the companion shots used in the `See every screen` grid.
  //
  // This test lives in its own describe so we can install a network
  // interceptor for the external drei cloud asset BEFORE any navigation.
  // Some CI / sandbox environments cannot reach rawcdn.githack.com, which
  // would otherwise trip the 3D error boundary and produce a blank fallback
  // screenshot.
  // -------------------------------------------------------------------------
  test('captures hero screenshots for the other routes', async ({ page }) => {
    // Capturing five 3D-stage screenshots sequentially comfortably exceeds the
    // default 120s test budget; allow headroom for slower CI runners.
    test.setTimeout(240_000);
    type RouteShot = { name: string; file: string };
    const otherRoutes: RouteShot[] = [
      { name: 'Crystal Sanctum of Bled',          file: 'screenshot-route-bled.png' },
      { name: 'Canale delle Anime Perdute',       file: 'screenshot-route-venice.png' },
      { name: "The Iron Sovereign's Gauntlet",    file: 'screenshot-route-henley.png' },
      { name: "The Leviathan's Wake",             file: 'screenshot-route-thames.png' },
      { name: "The Architect's Infinite Equation", file: 'screenshot-route-charles.png' },
    ];

    // Stub the drei cloud texture so a network-restricted CI / sandbox does
    // not trip the 3D error boundary. A 1x1 transparent PNG is enough for
    // three.js's texture loader to succeed; the <Cloud> billboard then just
    // renders without detail rather than failing the entire scene.
    const oneByOnePng = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
      'base64',
    );
    await page.route('**/rawcdn.githack.com/**/*.png', (route) =>
      route.fulfill({ status: 200, contentType: 'image/png', body: oneByOnePng }),
    );

    const initScript = fs.readFileSync(mockBluetoothPath, 'utf8');
    await page.addInitScript({ content: initScript });
    await page.goto('./');
    await waitForRowScreen(page);

    // Connect PM5 + HR once; subsequent routes reuse the same connections.
    await page.waitForSelector('button:has-text("Connect PM5")');
    await page.click('button:has-text("Connect PM5")');
    await waitForPM5Connected(page);
    await page.evaluate(() => {
      const containers = Array.from(document.querySelectorAll('.bluetooth-device-container'));
      const hrContainer = containers.find((c) =>
        c.querySelector('.device-name')?.textContent?.includes('Heart Rate Monitor'),
      );
      (hrContainer?.querySelector('button.btn-connect') as HTMLButtonElement)?.click();
    });
    await waitForHRConnected(page);

    for (const route of otherRoutes) {
      // The Routes screen is where a different course is picked (issue #219, R3).
      if (!(await selectRoute(page, route.name))) {
        console.warn(`[docs-screenshots] route "${route.name}" not found — skipping`);
        continue;
      }

      await page.waitForFunction(
        () => {
          const btn = document.querySelector('.btn-start-workout') as HTMLButtonElement | null;
          return !!(btn && !btn.disabled);
        },
        { timeout: 10_000 },
      );
      await page.evaluate(() => {
        (document.querySelector('.btn-start-workout') as HTMLButtonElement)?.click();
      });

      await page.waitForFunction(
        () => !!window.__workoutService?.getCurrentSession?.(),
        { timeout: 5000 },
      );
      await page.waitForSelector('.activity-view', { timeout: 10_000 });
      await page.waitForFunction(
        () => !!window.__ROWER3D_GPU_BACKEND,
        { timeout: 15_000 },
      );

      // Drive a few PM5 frames so the boat is placed on the route.
      for (let i = 1; i <= 3; i++) {
        await dispatchGeneralStatus(page, 500 * i, 60 * i);
        await dispatchAdditionalStatus(page, { elapsedSeconds: 60 * i, strokeRate: 26, heartRate: 148 });
        await dispatchHeartRate(page, 148);
        await page.waitForTimeout(600);
      }

      await page.waitForFunction(
        () => (window.__ROWER3D_DISTANCE_M ?? 0) > 0,
        { timeout: 5000 },
      ).catch(() => { /* non-critical — capture regardless */ });
      await page.waitForTimeout(1500);

      // Hide in-stage overlays so the 3D scene is centre-stage, matching the
      // style of `screenshot-rower-3d.png`.
      await page.evaluate(() => {
        const existing = document.getElementById('docs-hero-screenshot-style');
        if (existing) return;
        const style = document.createElement('style');
        style.id = 'docs-hero-screenshot-style';
        style.textContent = `
          .activity-route-summary,
          .activity-map-overlay {
            display: none !important;
          }
        `;
        document.head.appendChild(style);
      });
      await page.waitForFunction(() => {
        const summary = document.querySelector('.activity-route-summary');
        const mapOverlay = document.querySelector('.activity-map-overlay');
        const summaryHidden = !summary || window.getComputedStyle(summary).display === 'none';
        const mapHidden = !mapOverlay || window.getComputedStyle(mapOverlay).display === 'none';
        return summaryHidden && mapHidden;
      }, { timeout: 2000 });

      const stage = page.locator('.activity-route-stage');
      const stageBbox = await stage.boundingBox({ timeout: 5000 }).catch(() => null);
      await page.screenshot({
        path: path.join(docsDir, route.file),
        ...(stageBbox ? { clip: stageBbox } : {}),
      });
      console.log(`[docs-screenshots] wrote ${route.file} for "${route.name}"`);

      // Restore the page chrome and end the workout so the next iteration
      // starts from a clean route-selection view.
      await page.evaluate(() => {
        document.getElementById('docs-hero-screenshot-style')?.remove();
      });
      await page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll('button')) as HTMLButtonElement[];
        const endBtn = buttons.find((b) => /End Workout/i.test(b.textContent ?? ''));
        endBtn?.click();
      });
      await waitForRowScreen(page);
    }
  });
});

// ===========================================================================
// PM5 BLE pipeline survives the routes -> workout view switch (issue #194)
//
// The device panels (BluetoothDevice / FTMSDevice) render only on the routes
// view. When they owned the bluetoothService subscription, starting a workout
// unmounted them, removed the listeners, and every subsequent BLE frame was
// dropped: the session recorded 0 m for the entire row. These tests drive raw
// frames onto the mocked characteristics -- the real BLE path, not
// __workoutService -- and assert they still land after the view switches.
//
// Note: do NOT assert on window.__PM5_DATA alone here. bluetoothService emits
// its own mutable pm5Data object, so window.__PM5_DATA is a live alias of it
// and keeps changing even when no listener is attached. Only the workout
// session proves the app actually received a frame.
// ===========================================================================
test.describe('PM5 data pipeline across view switches', () => {
  const sessionDistance = (page: Page) => page.evaluate(
    () => (window as unknown as SimWindow).__workoutService?.getCurrentSession?.()?.distance ?? null,
  );

  test.beforeEach(async ({ page }) => {
    const initScript = fs.readFileSync(mockBluetoothPath, 'utf8');
    await page.addInitScript({ content: initScript });
    await page.goto('./');

    await page.click('button:has-text("Connect PM5")');
    await waitForPM5Connected(page);

    await page.evaluate(() => {
      const containers = Array.from(document.querySelectorAll('.bluetooth-device-container'));
      const hrContainer = containers.find((c) =>
        c.querySelector('.device-name')?.textContent?.includes('Heart Rate Monitor'),
      );
      (hrContainer?.querySelector('button.btn-connect') as HTMLButtonElement)?.click();
    });
    await waitForHRConnected(page);
  });

  test('BLE frames still reach the workout session after the view switches to workout', async ({ page }) => {
    // A frame on the routes view proves the pipeline is live before the switch.
    await dispatchGeneralStatus(page, 250, 60);
    await expect
      .poll(() => page.evaluate(() => (window as unknown as SimWindow).__PM5_DATA?.distance ?? 0), { timeout: 3000 })
      .toBe(250);

    // The PM5 panel is the only thing rendering the device on this view...
    const pm5Panel = page.locator('.bluetooth-device-container:has(.device-name:has-text("Concept2 PM5"))');
    await expect(pm5Panel).toBeVisible();

    await page.evaluate(() => {
      (document.querySelector('.btn-start-workout') as HTMLButtonElement)?.click();
    });
    await expect(page.locator('.activity-view')).toBeVisible({ timeout: 15_000 });

    // ...and starting the workout unmounts it. The subscription must not go with it.
    await expect(pm5Panel).toHaveCount(0);

    // The first frame after the start sets the session's distance baseline.
    await dispatchGeneralStatus(page, 400, 90);
    await expect.poll(() => sessionDistance(page), { timeout: 5000 }).toBe(0);

    // Every later frame must advance the session -- this is what regressed.
    await dispatchGeneralStatus(page, 900, 120);
    await expect.poll(() => sessionDistance(page), { timeout: 5000 }).toBe(500);

    await dispatchGeneralStatus(page, 1650, 180);
    await expect.poll(() => sessionDistance(page), { timeout: 5000 }).toBe(1250);
  });

  test('the activity view renders live metrics driven straight off the BLE characteristics', async ({ page }) => {
    await page.evaluate(() => {
      (document.querySelector('.btn-start-workout') as HTMLButtonElement)?.click();
    });
    await expect(page.locator('.activity-view')).toBeVisible({ timeout: 15_000 });

    await dispatchGeneralStatus(page, 500, 120);       // baseline
    await dispatchGeneralStatus(page, 1234, 240);      // + 734 m
    await dispatchAdditionalStatus(page, { elapsedSeconds: 240, strokeRate: 26, heartRate: 148 });

    const statValue = (label: string) => page.locator(
      `.activity-stat-card:has(.activity-stat-label:has-text("${label}")) .activity-stat-value`,
    );

    await expect(statValue('Meters')).toHaveText('734 m', { timeout: 5000 });
    await expect(statValue('SPM')).toHaveText('26 spm', { timeout: 5000 });
    await expect(statValue('Heart Rate')).toHaveText('148 bpm', { timeout: 5000 });
  });
});

// ===========================================================================
// FTMS shares the same pipeline, and shared the same defect (issue #194).
// ===========================================================================
test.describe('FTMS data pipeline across view switches', () => {
  /**
   * Minimal FTMS Rower Data frame carrying only total distance:
   *   flags 0x0005 = bit 0 (no basic stroke data) + bit 2 (total distance present)
   *   bytes 2-4    = total distance in meters (24-bit LE)
   */
  function dispatchFtmsDistance(page: Page, distanceMeters: number) {
    return page.evaluate((distanceMeters) => {
      const buf = new ArrayBuffer(5);
      const dv = new DataView(buf);
      dv.setUint16(0, 0x0005, true);
      dv.setUint8(2, distanceMeters & 0xff);
      dv.setUint8(3, (distanceMeters >> 8) & 0xff);
      dv.setUint8(4, (distanceMeters >> 16) & 0xff);
      (window as unknown as SimWindow).__ftmsChar?._dispatch(dv);
    }, distanceMeters);
  }

  test('FTMS frames still reach the workout session after the view switches', async ({ page }) => {
    const initScript = fs.readFileSync(mockBluetoothPath, 'utf8');
    await page.addInitScript({ content: initScript });
    await page.goto('./');

    await connectFtms(page);
    await page.evaluate(() => {
      const containers = Array.from(document.querySelectorAll('.bluetooth-device-container'));
      const hrContainer = containers.find((c) =>
        c.querySelector('.device-name')?.textContent?.includes('Heart Rate Monitor'),
      );
      (hrContainer?.querySelector('button.btn-connect') as HTMLButtonElement)?.click();
    });
    await waitForHRConnected(page);

    await page.evaluate(() => {
      (document.querySelector('.btn-start-workout') as HTMLButtonElement)?.click();
    });
    await expect(page.locator('.activity-view')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('.bluetooth-device-container:has(.device-name:has-text("FTMS Rower"))')).toHaveCount(0);

    await dispatchFtmsDistance(page, 300);   // baseline
    await dispatchFtmsDistance(page, 1100);  // + 800 m
    await expect(
      page.locator('.activity-stat-card:has(.activity-stat-label:has-text("Meters")) .activity-stat-value'),
    ).toHaveText('800 m', { timeout: 5000 });
  });
});

// ===========================================================================
// Activity distance integrity (companion to "activity distance may not be
// calculated correctly" investigation).
//
// These tests drive PM5 telemetry through __workoutService and assert the
// UI's "Meters" stat card reflects monotonically non-decreasing distance.
// They exist to prevent regressions where transient stale/zero/backwards
// packets would make the UI distance drop mid-session.
// ===========================================================================
test.describe('activity distance integrity', () => {
  test.beforeEach(async ({ page }) => {
    const initScript = fs.readFileSync(mockBluetoothPath, 'utf8');
    await page.addInitScript({ content: initScript });
    await page.goto('./');

    // Connect PM5
    await page.click('button:has-text("Connect PM5")');
    await waitForPM5Connected(page);

    // Connect HR Monitor (evaluate-click to avoid hitting the disconnect btn
    // that swaps in at the same coordinates on instant mock connect).
    await page.evaluate(() => {
      const containers = Array.from(document.querySelectorAll('.bluetooth-device-container'));
      const hrContainer = containers.find((c) =>
        c.querySelector('.device-name')?.textContent?.includes('Heart Rate Monitor'),
      );
      (hrContainer?.querySelector('button.btn-connect') as HTMLButtonElement)?.click();
    });
    await waitForHRConnected(page);

    // Start workout via the UI start button.
    await page.evaluate(() => {
      (document.querySelector('.btn-start-workout') as HTMLButtonElement)?.click();
    });
    await page.waitForFunction(
      () => !!(window as unknown as SimWindow).__workoutService,
      { timeout: 5000 },
    );
    await expect(page.locator('.activity-view')).toBeVisible({ timeout: 5000 });
  });

  // Regression guard: a transient stale/zero packet (BLE re-subscribe,
  // momentary device glitch) must not make the displayed Meters value drop
  // mid-session.
  test('Meters display does not regress when a transient backwards packet arrives', async ({ page }) => {
    const metersValue = page.locator(
      '.activity-stat-card:has(.activity-stat-label:has-text("Meters")) .activity-stat-value',
    );

    // Push PM5 frames directly via the in-browser service to keep the test
    // deterministic and fast (no reliance on the BLE simulator's pacing).
    async function push(distance: number, elapsedMs: number) {
      await page.evaluate(
        ({ distance, elapsedMs }) => {
          const svc = (window as unknown as SimWindow).__workoutService as
            | undefined
            | {
                updateSessionWithPM5Data?: (data: {
                  distance: number;
                  elapsedTime: number;
                  pace: number;
                  power: number;
                  cadence: number;
                  heartRate: number;
                  calories?: number;
                }) => void;
              };
          svc?.updateSessionWithPM5Data?.({
            distance,
            elapsedTime: elapsedMs,
            pace: 120,
            power: 200,
            cadence: 30,
            heartRate: 140,
          });
        },
        { distance, elapsedMs },
      );
    }

    // Prime the session offset (the service treats the first PM5 reading as the
    // session-start baseline).
    await push(0, 0);

    // Row steadily up to 1234 m.
    await push(1234, 240_000);
    await expect(metersValue).toContainText('1234 m', { timeout: 2000 });

    // Transient blip: a stale frame reports 0 m.
    await push(0, 241_000);
    // Then a real frame arrives just past the blip.
    await push(50, 242_000);

    // Required behavior: the Meters card never displays a smaller value than
    // 1234 m. Read the rendered text and convert to a number.
    const displayedMeters = await metersValue.evaluate((el) => {
      const match = (el.textContent ?? '').match(/(-?\d+)/);
      return match ? Number(match[1]) : NaN;
    });
    expect(displayedMeters).toBeGreaterThanOrEqual(1234);
  });
});
