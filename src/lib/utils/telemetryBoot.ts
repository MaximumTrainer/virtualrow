import { openTelemetry, recordTelemetry } from './sceneTelemetryLog';

// ============================================================================
// START RECORDING, AND CATCH WHAT NOBODY ELSE DOES
//
// The scene records its own lifecycle — a context made, lost, restored, a
// boundary tripped. What it cannot record is the thing that stops it running:
// an uncaught error, or a rejected promise nobody handled. Those are what a
// crash usually leaves behind, so they are picked up here at the top.
// ============================================================================

/** So a hot reload or a double call does not install two listeners. */
let started = false;

/**
 * The listeners, kept so they can be taken off again.
 *
 * Only tests need that, but they need it badly: these append to a log that is
 * module state, so a test file that starts telemetry and never stops it goes on
 * writing into another file's log for the rest of the process. That is what
 * turned this into a failure that only appeared on CI, where the worker
 * assignment differs.
 */
let installed: Array<[string, EventListener]> = [];

/**
 * Begin the telemetry log for this tab, recovering whatever the last run left.
 *
 * `sessionStorage` by choice: it survives the reload a killed renderer
 * produces, which is the case worth catching, and it goes when the tab does.
 */
export const startTelemetry = (storage: Storage | null = safeSessionStorage()): void => {
  if (started) return;
  started = true;

  openTelemetry(storage);

  const listen = (type: string, handler: EventListener): void => {
    window.addEventListener(type, handler);
    installed.push([type, handler]);
  };

  try {
    listen('error', (event) => {
      const error = event as ErrorEvent;
      recordTelemetry('error', {
        message: error.message,
        source: error.filename
          ? `${error.filename}:${error.lineno}:${error.colno}`
          : undefined,
      });
    });

    listen('unhandledrejection', (event) => {
      const reason = (event as PromiseRejectionEvent).reason;
      recordTelemetry('unhandled-rejection', {
        message: reason instanceof Error ? reason.message : String(reason).slice(0, 200),
      });
    });

    // Whether the tab went away tidily or was taken away. A log that ends
    // without this line ended in something worse than a closed tab.
    listen('pagehide', () => recordTelemetry('page-hide'));
  } catch {
    // No window, or a browser refusing listeners. The log still works.
  }
};

/** `sessionStorage`, or nothing, without throwing in a private window. */
function safeSessionStorage(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

/**
 * Stop recording and take the listeners off again.
 *
 * For tests. Without it, one test file's listeners write into the next file's
 * log for the rest of the process, and which files share a process depends on
 * how many cores the machine has - so it passes on a developer's machine and
 * fails on CI.
 */
export const stopTelemetryForTests = (): void => {
  for (const [type, handler] of installed) {
    try {
      window.removeEventListener(type, handler);
    } catch {
      // Nothing to do about it.
    }
  }
  installed = [];
  started = false;
};
