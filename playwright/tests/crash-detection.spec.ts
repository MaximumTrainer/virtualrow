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

  // Killed through the DevTools protocol rather than by navigating to
  // chrome://crash. That navigation first-attempt-failed on every CI run
  // checked, main included: the event did not arrive within 30 s, and the
  // retries that passed took minutes - a debug URL's kill depends on how the
  // navigation to it is carried out, and on a loaded runner that was not
  // prompt. `Page.crash` is one command to this tab's renderer and nothing
  // else. What the test proves is unchanged: that Chromium under these launch
  // flags raises `crash` for the tab, and the evidence was read above.
  const cdp = await page.context().newCDPSession(page);
  const crashed = page.waitForEvent('crash', { timeout: 30_000 });
  const started = Date.now();
  let sent = 'Page.crash never answered, which is expected: the renderer died';
  void cdp.send('Page.crash').then(
    () => { sent = `Page.crash answered after ${Date.now() - started} ms without crashing`; },
    (error: Error) => { sent = `Page.crash rejected after ${Date.now() - started} ms: ${error.message}`; },
  );
  await crashed.catch((error: Error) => {
    throw new Error(`${error.message} (${sent})`);
  });

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
