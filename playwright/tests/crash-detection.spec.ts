import { test as base, expect, type Page } from '@playwright/test';
import { describeCrashEvidence } from '../../src/utils/crashEvidence';
import type { TelemetryEvent } from '../../src/utils/sceneTelemetryLog';

/**
 * The crash guard has to actually fire in this browser.
 *
 * `crashEvidence.test.ts` proves the rule. It cannot prove that Chromium under
 * these launch flags raises `crash` at all, or that the telemetry log is still
 * readable after a reload — and a guard that is correct but never triggered is
 * indistinguishable from no guard.
 *
 * This file imports `test` from `@playwright/test` rather than from the crash
 * fixture, deliberately and as the single exception in the suite: it kills a
 * page on purpose, and the fixture would fail the test for doing its job. The
 * ESLint rule that stops every other spec importing the base `test` names this
 * file.
 */

const TELEMETRY_STORAGE_KEY = 'virtualrow:scene-telemetry';

const readTelemetry = (page: Page): Promise<TelemetryEvent[]> =>
  page.evaluate((key) => {
    try {
      const raw = sessionStorage.getItem(key);
      return raw ? (JSON.parse(raw) as TelemetryEvent[]) : [];
    } catch {
      return [];
    }
  }, TELEMETRY_STORAGE_KEY);

base('a renderer killed outright raises a crash event here', async ({ page }) => {
  base.slow();

  let crashEventFired = false;
  page.on('crash', () => {
    crashEventFired = true;
  });

  await page.goto('./');
  await page.locator('.btn-try-demo').click();
  await page.locator('.rower3d-canvas-container').waitFor({ state: 'visible', timeout: 30_000 });

  // The telemetry has to exist before the page dies, or the attachment the
  // guard promises would be empty.
  await expect
    .poll(async () => (await readTelemetry(page)).length, { timeout: 30_000, intervals: [1000] })
    .toBeGreaterThan(0);
  const before = await readTelemetry(page);
  expect(before.map((e) => e.kind)).toContain('run-start');

  // Killed with SIGKILL, from outside, the way the OOM killer takes a tab.
  //
  // This used to navigate to chrome://crash, and then send `Page.crash`. Both
  // crash the renderer from inside, and a crashing process dumps core before
  // it is gone - so the browser cannot report the crash until the dump is
  // written. A renderer drawing this scene reserves about 1.3 TB of address
  // space; locally, with core dumps on, that took the event from 12 ms to
  // 17 s, and on CI, where the dump goes to a pipe that cannot skip the holes,
  // it took minutes. The first attempt failed on every run and main went red
  // (#386). SIGKILL dumps nothing, so the event depends on the browser alone,
  // which is the thing this test is about.
  const browserSession = await page.context().browser()!.newBrowserCDPSession();
  const { processInfo } = (await browserSession.send('SystemInfo.getProcessInfo')) as {
    processInfo: { type: string; id: number }[];
  };
  await browserSession.detach();
  // Each test has its own context and each worker its own browser, so the
  // renderers here are this page's (and at most a spare, which is harmless
  // to kill).
  const renderers = processInfo.filter((p) => p.type === 'renderer').map((p) => p.id);
  expect(renderers.length, 'the browser reported no renderer process to kill').toBeGreaterThan(0);

  const crashed = page.waitForEvent('crash', { timeout: 30_000 });
  const killStarted = Date.now();
  for (const pid of renderers) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // Already gone - a spare renderer can exit on its own.
    }
  }
  await crashed;
  console.log(`[crash-detection] crash event ${Date.now() - killStarted} ms after SIGKILL`);

  // And the rule agrees, on the evidence a real run would hand it.
  const verdict = describeCrashEvidence({ crashEventFired, events: before });
  expect(verdict.crashed).toBe(true);
  expect(verdict.reason).toBe('the renderer process crashed');
});

base('a deliberate reload leaves a log the guard reads as tidy', async ({ page }) => {
  base.slow();

  await page.goto('./');
  await page.locator('.btn-try-demo').click();
  await page.locator('.rower3d-canvas-container').waitFor({ state: 'visible', timeout: 30_000 });
  await expect
    .poll(async () => (await readTelemetry(page)).length, { timeout: 30_000, intervals: [1000] })
    .toBeGreaterThan(0);

  await page.reload();

  // Not waiting for the canvas: a reload lands on the setup view, because a
  // demo row is not in the URL and nothing restores it. That is the gap this
  // guard exists to make visible elsewhere, and it does not matter here — the
  // telemetry log is opened at boot on every load, whatever view comes up.
  await page.waitForLoadState('domcontentloaded');

  // Two runs in one log, which only works because it is in session storage.
  const events = await expect
    .poll(async () => (await readTelemetry(page)).filter((e) => e.kind === 'run-start').length, {
      timeout: 30_000,
      intervals: [1000],
    })
    .toBeGreaterThan(1)
    .then(() => readTelemetry(page));

  // The signal that tells this apart from a crash: the tab said it was going.
  expect(
    events.map((e) => e.kind),
    'nothing recorded the tab going away, so a tidy reload is indistinguishable from a kill',
  ).toContain('page-hide');

  const verdict = describeCrashEvidence({ crashEventFired: false, events });
  expect(verdict.crashed, `the guard called a deliberate reload a crash: ${verdict.reason}`).toBe(
    false,
  );
});
