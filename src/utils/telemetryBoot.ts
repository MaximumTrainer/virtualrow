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
 * Begin the telemetry log for this tab, recovering whatever the last run left.
 *
 * `sessionStorage` by choice: it survives the reload a killed renderer
 * produces, which is the case worth catching, and it goes when the tab does.
 */
export const startTelemetry = (storage: Storage | null = safeSessionStorage()): void => {
  if (started) return;
  started = true;

  openTelemetry(storage);

  try {
    window.addEventListener('error', (event) => {
      recordTelemetry('error', {
        message: event.message,
        source: event.filename ? `${event.filename}:${event.lineno}:${event.colno}` : undefined,
      });
    });

    window.addEventListener('unhandledrejection', (event) => {
      const reason = (event as PromiseRejectionEvent).reason;
      recordTelemetry('unhandled-rejection', {
        message: reason instanceof Error ? reason.message : String(reason).slice(0, 200),
      });
    });

    // Whether the tab went away tidily or was taken away. A log that ends
    // without this line ended in something worse than a closed tab.
    window.addEventListener('pagehide', () => recordTelemetry('page-hide'));
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
