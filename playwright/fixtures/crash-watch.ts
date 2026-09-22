import { test as base, type Page, type TestInfo } from '@playwright/test';
import { describeCrashEvidence } from '../../src/utils/crashEvidence';
import { formatTelemetry } from '../../src/utils/sceneTelemetryLog';
import type { TelemetryEvent } from '../../src/utils/sceneTelemetryLog';
import { simPortsForWorker } from '../utils/simPorts';
import { releaseSimServer, useSimServer } from '../utils/sim-server';

/**
 * Fail a spec whose renderer died, whether or not the spec was looking.
 *
 * Twenty-six of the twenty-eight specs never asked, and the two that did would
 * have missed the one crash this repository has seen: #301's tab death raised
 * no `crash` event, because the browser killed the renderer and restored the
 * tab. Playwright saw a navigation.
 *
 * So two signals, not one. `page.on('crash')` catches the process dying under
 * us. The telemetry log catches the other shape — a tab that came back without
 * ever saying it was going — and it survives the reload that destroys every
 * other reading, which is the whole reason sceneTelemetryLog writes through to
 * session storage.
 *
 * Every spec under playwright/tests/ imports `test` from here rather than from
 * `@playwright/test`, and the ESLint config makes that not a matter of memory.
 */

/** Where sceneTelemetryLog keeps the log. Read, never written, from here. */
const TELEMETRY_STORAGE_KEY = 'virtualrow:scene-telemetry';

/**
 * How often the log is copied out of the page.
 *
 * A crashed page cannot be evaluated against, so the copy has to already exist
 * by the time anyone wants it. Five seconds is the scene's own sample interval;
 * sampling faster would cost round trips to learn nothing new.
 */
const SNAPSHOT_INTERVAL_MS = 5_000;

const readTelemetry = async (page: Page): Promise<TelemetryEvent[]> => {
  try {
    return await page.evaluate((key) => {
      try {
        const raw = sessionStorage.getItem(key);
        if (!raw) return [];
        const parsed: unknown = JSON.parse(raw);
        return Array.isArray(parsed) ? (parsed as TelemetryEvent[]) : [];
      } catch {
        return [];
      }
    }, TELEMETRY_STORAGE_KEY);
  } catch {
    // The page is gone, navigating, or closed. The last snapshot stands, which
    // is exactly the case this whole fixture exists for.
    return [];
  }
};

type CrashWatchWorkerFixtures = {
  /**
   * One simulator per worker, for the whole worker.
   *
   * The workflow used to start a single shared one before Playwright, so every
   * page that injected `mock-bluetooth.js` found something on 9001 whether or
   * not its spec cared. Removing that shared server to make room for
   * per-worker ones took the guarantee with it, and specs that never asked for
   * a simulator started logging `ERR_CONNECTION_REFUSED` - which
   * `rownative-course-import.spec.ts`, whose whole assertion is that the
   * console stays clean, failed on.
   *
   * Worker-scoped and auto-use, so it is started once per worker and every
   * spec gets the guarantee back on its own ports.
   */
  simServer: void;
};

type CrashWatchFixtures = {
  /**
   * Tell the page which simulator to talk to, before any of its scripts run.
   *
   * Auto-use and installed here rather than in each spec, because
   * twenty-six spec files inject `mock-bluetooth.js` and a port every one of
   * them had to remember would be a port one of them forgot. The mock reads
   * `window.__SIM_PORTS` and falls back to worker zero's, so nothing breaks if
   * this ever fails to run.
   */
  simPorts: void;

  /**
   * Installed for every test, whether or not the test mentions it.
   *
   * Auto-use, because a guard nobody remembers to switch on is not a guard.
   */
  crashWatch: void;
};

export const test = base.extend<CrashWatchFixtures, CrashWatchWorkerFixtures>({
  simServer: [
    // Playwright reads the destructured names to work out what a fixture
    // depends on, so the first argument has to be a pattern even when the
    // fixture depends on nothing - `_unused` is rejected at runtime.
    // eslint-disable-next-line no-empty-pattern
    async ({}, use) => {
      await useSimServer();
      await use();
      await releaseSimServer();
    },
    { scope: 'worker', auto: true },
  ],

  simPorts: [
    async ({ page }, use, testInfo: TestInfo) => {
      // `parallelIndex`, not `workerIndex`: it stays inside [0, workers) even
      // after a worker is restarted, so a crash mid-run cannot walk the ports
      // off into a range nothing cleans up. It is the same value
      // `utils/sim-server.ts` starts this worker's simulator on.
      const ports = simPortsForWorker(testInfo.parallelIndex);
      await page.addInitScript((value) => {
        (window as unknown as { __SIM_PORTS?: unknown }).__SIM_PORTS = value;
      }, ports);
      await use();
    },
    { auto: true },
  ],

  crashWatch: [
    async ({ page }, use, testInfo: TestInfo) => {
      let crashEventFired = false;
      page.on('crash', () => {
        crashEventFired = true;
      });

      // The last log we managed to read while the page was alive.
      let snapshot: TelemetryEvent[] = [];
      const timer = setInterval(() => {
        void readTelemetry(page).then((events) => {
          if (events.length > 0) snapshot = events;
        });
      }, SNAPSHOT_INTERVAL_MS);

      await use();

      clearInterval(timer);

      // One last look. If the page survived, this is the complete log and
      // better than any snapshot; if it did not, the snapshot is what there is.
      const finalRead = await readTelemetry(page);
      const events = finalRead.length > 0 ? finalRead : snapshot;

      const verdict = describeCrashEvidence({ crashEventFired, events });
      if (!verdict.crashed) return;

      // Attached before the failure is raised, so the evidence survives even
      // though the assertion below ends the test.
      await testInfo.attach('scene-telemetry', {
        body: formatTelemetry(events),
        contentType: 'text/plain',
      });

      throw new Error(
        `${testInfo.title}: ${verdict.reason}. The scene telemetry from before ` +
          `it died is attached as "scene-telemetry".`,
      );
    },
    { auto: true },
  ],
});

/**
 * Everything else Playwright exports, unchanged.
 *
 * A spec imports `expect`, `type Page`, `type Locator` and the rest from the
 * same place it imports `test`, so switching over is one import line and not a
 * second one that still reaches past the guard. An explicit local export — the
 * `test` above — shadows the same name from a star export, so this re-exports
 * the base `test` to nobody.
 */
export * from '@playwright/test';
