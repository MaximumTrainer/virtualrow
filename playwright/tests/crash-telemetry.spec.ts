import { test, expect, type Page } from '../fixtures/crash-watch';
import type { CrashPayload } from '../../src/types/crashPayload';

/**
 * Crash telemetry e2e (issue #473, Phase 2, AC1 + AC2).
 *
 * Phase 2 ships the boot-time check (FR1) and the error-boundary wiring (FR2)
 * against the Phase 1 stub transport. The transport appends every captured
 * payload to `window.__VIRTUALROW_CAPTURED_CRASHES__` when a spec seeds that
 * array, which is this spec's test seam: nothing production sets it, so the
 * branch is a no-op outside Playwright.
 *
 * The real `repository_dispatch` transport (D1 = a) lands in Phase 3 and gets
 * its own spec against a mock URL.
 */

const TELEMETRY_STORAGE_KEY = 'virtualrow:scene-telemetry';
const CAPTURED_KEY = '__VIRTUALROW_CAPTURED_CRASHES__';

const seedCapture = async (page: Page): Promise<void> => {
  // Install BEFORE the first navigation so the array exists in time for the
  // boot-time report to find it.
  await page.addInitScript(`window.${CAPTURED_KEY} = [];`);
};

const seedPriorCrash = async (page: Page): Promise<void> => {
  // The telemetry log the previous (killed) run left behind. One run-start, one
  // error, no page-hide — the "renderer killed, tab restored" shape from #301.
  // openTelemetry appends a fresh run-start on load, so describeCrashEvidence
  // then sees two run-starts without a page-hide between them.
  const priorEvents = JSON.stringify([
    { at: 10, kind: 'run-start', detail: { recovered: 0 } },
    { at: 1200, kind: 'error', detail: { message: 'simulated prior crash', source: 'app.js:1:1' } },
  ]);
  await page.addInitScript(
    `try { sessionStorage.setItem('${TELEMETRY_STORAGE_KEY}', ${JSON.stringify(priorEvents)}); } catch {}`,
  );
};

const readCaptured = (page: Page): Promise<CrashPayload[]> =>
  page.evaluate((key) => {
    const w = window as unknown as Record<string, unknown>;
    const captured = w[key];
    return Array.isArray(captured) ? (captured as CrashPayload[]) : [];
  }, CAPTURED_KEY);

test('AC1: a crash from the previous run is reported within 3s of boot', async ({ page }) => {
  await seedCapture(page);
  await seedPriorCrash(page);

  await page.goto('./');

  await expect
    .poll(async () => (await readCaptured(page)).length, {
      timeout: 3_000,
      intervals: [100, 200, 500],
    })
    .toBe(1);

  const captured = await readCaptured(page);
  const payload = captured[0]!;
  expect(payload.verdict?.crashed).toBe(true);
  expect(payload.schemaVersion).toBe(1);
  expect(payload.errorSummary?.message).toBe('simulated prior crash');
  // Redaction keeps a readable breadcrumb through the telemetry text.
  expect(payload.telemetryText).toContain('error');
  // Nothing identifying leaks: the stub transport sees exactly what Phase 3
  // would POST, so these invariants hold here too (NFR4).
  const serialised = JSON.stringify(payload);
  expect(serialised).not.toMatch(/@[\w.-]+\.[a-z]{2,}/i);
  expect(serialised).not.toMatch(/-?\d{1,2}\.\d{4,}, ?-?\d{1,3}\.\d{4,}/);
});

test('AC1: no prior crash → no report is enqueued', async ({ page }) => {
  await seedCapture(page);
  // No sessionStorage seed: this is a fresh browser load.
  await page.goto('./');
  // Give FR1 a generous idle window to run and NOT send.
  await page.waitForTimeout(1_500);
  const captured = await readCaptured(page);
  expect(captured).toHaveLength(0);
});

test('AC2: a boundary catch produces one report with the thrown message', async ({ page }) => {
  // Flag the __PLAYWRIGHT_TESTING hook so main.tsx exposes the boundary
  // simulation seam — nothing production exposes it.
  await page.addInitScript(`window.__PLAYWRIGHT_TESTING = true;`);
  await seedCapture(page);
  await page.goto('./');
  await page.waitForLoadState('networkidle');

  // Call the production FR2 code path. The seam calls the SAME
  // `reportFromErrorBoundary(crashReporterService, …)` the boundaries do from
  // `componentDidCatch`, so this exercises the microtask defer and the stub
  // transport exactly as a real boundary trip would. The vitest suite covers
  // the "throw during render" half (see `canvas3DErrorBoundary.test.tsx` and
  // `sceneErrorBoundary.test.tsx`).
  await page.evaluate(() => {
    const w = window as unknown as Record<string, unknown> & {
      __VIRTUALROW_SIMULATE_BOUNDARY__?: (msg: string) => void;
    };
    if (typeof w.__VIRTUALROW_SIMULATE_BOUNDARY__ !== 'function') {
      throw new Error('the __VIRTUALROW_SIMULATE_BOUNDARY__ seam is missing');
    }
    w.__VIRTUALROW_SIMULATE_BOUNDARY__('boundary caught: simulated child throw');
  });

  await expect
    .poll(async () => (await readCaptured(page)).length, {
      timeout: 2_000,
      intervals: [50, 100, 200],
    })
    .toBe(1);

  const captured = await readCaptured(page);
  const payload = captured[0]!;
  expect(payload.errorSummary?.message).toBe('boundary caught: simulated child throw');
  expect(payload.verdict?.reason).toContain('Canvas3D');
});
