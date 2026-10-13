/**
 * Boot-time crash check and error-boundary wiring (issue #473, FR1 / FR2).
 *
 * This file is the one place that marries three things that previously stood
 * alone: the `sceneTelemetryLog` recovered from `sessionStorage`, the pure
 * `describeCrashEvidence` verdict, and the `CrashReporterPort`. Call-sites
 * (boot, the two React error boundaries) depend only on this file so the
 * Phase 3 transport swap does not touch them (NFR3).
 *
 * All work is deferred and swallowing: a crash reporter that itself crashes,
 * or that stalls the first paint, is worse than silence (NFR2).
 */
import type { CrashReporterPort } from '../ports';
import { describeCrashEvidence } from './crashEvidence';
import { readTelemetry, formatTelemetry } from './sceneTelemetryLog';
import type { CrashPayload } from '../types/crashPayload';
import type { PerformanceMode } from '../components/rower3d/constants';

interface BootCrashOptions {
  /** The scheduler to defer the report onto. Tests pass a synchronous shim. */
  schedule?: (callback: () => void) => void;
  /** `VITE_BUILD_SHA` injection, so the browser reports which commit crashed. */
  buildSha?: string;
  /** The resolved performance tier at this moment. */
  performanceMode?: PerformanceMode;
  /** The signed-in athlete's intervals.icu id when known (D2 = b). */
  intervalsIcuAthleteId?: string | null;
}

const defaultSchedule = (callback: () => void): void => {
  // `requestIdleCallback` is Chrome / Edge / Opera today; fall back to a short
  // `setTimeout` on Safari and Firefox so the behaviour is the same shape.
  try {
    const g = globalThis as unknown as {
      requestIdleCallback?: (cb: () => void, options?: { timeout: number }) => number;
    };
    if (typeof g.requestIdleCallback === 'function') {
      g.requestIdleCallback(callback, { timeout: 2_000 });
      return;
    }
  } catch {
    // ignored
  }
  try {
    setTimeout(callback, 500);
  } catch {
    // Last resort: run inline.
    callback();
  }
};

const safeViewport = (): CrashPayload['viewport'] => {
  try {
    return {
      w: Math.max(0, Math.round(window.innerWidth)),
      h: Math.max(0, Math.round(window.innerHeight)),
      dpr: Math.max(0, window.devicePixelRatio || 1),
    };
  } catch {
    return { w: 0, h: 0, dpr: 1 };
  }
};

const safeUserAgent = (): string => {
  try {
    return typeof navigator !== 'undefined' ? navigator.userAgent : '';
  } catch {
    return '';
  }
};

const nowIso = (): string => {
  try {
    return new Date().toISOString();
  } catch {
    return '1970-01-01T00:00:00Z';
  }
};

const firstErrorSummary = (
  events: ReturnType<typeof readTelemetry>,
): CrashPayload['errorSummary'] => {
  const errorEvent = events.find(
    (event) => event.kind === 'error' || event.kind === 'unhandled-rejection',
  );
  if (!errorEvent || !errorEvent.detail) return null;
  const message = typeof errorEvent.detail.message === 'string' ? errorEvent.detail.message : '';
  const source = typeof errorEvent.detail.source === 'string' ? errorEvent.detail.source : null;
  if (!message) return null;
  return { message, firstFrame: source };
};

/**
 * Called once from `main.tsx` right after `startTelemetry()`.
 *
 * If the recovered log shows the previous run died without a `page-hide`, the
 * reporter is asked to send one crash report, deferred to idle so the first
 * paint is never delayed (NFR2).
 */
export const checkBootCrash = (
  reporter: CrashReporterPort,
  options: BootCrashOptions = {},
): void => {
  const schedule = options.schedule ?? defaultSchedule;
  try {
    const events = readTelemetry();
    const verdict = describeCrashEvidence({ crashEventFired: false, events });
    if (!verdict.crashed) return;

    schedule(() => {
      try {
        void reporter.reportCrash({
          buildSha: options.buildSha,
          occurredAt: nowIso(),
          verdict: { crashed: true, reason: verdict.reason },
          userAgent: safeUserAgent(),
          viewport: safeViewport(),
          performanceMode: options.performanceMode,
          errorSummary: firstErrorSummary(events),
          telemetryText: formatTelemetry(events),
          intervalsIcuAthleteId: options.intervalsIcuAthleteId ?? null,
        });
      } catch {
        // NFR2: never throw into the boot path.
      }
    });
  } catch {
    // ignored
  }
};

interface BoundaryReportOptions {
  /** Short name of the rung that caught, e.g. "Canvas3D" or "scene content". */
  boundary: string;
  buildSha?: string;
  performanceMode?: PerformanceMode;
  intervalsIcuAthleteId?: string | null;
}

/**
 * Called from `componentDidCatch` in both error boundaries.
 *
 * Deferred with `queueMicrotask` so the boundary's render path is never on the
 * call stack when `reportCrash` runs — a boundary that threw while reporting
 * would otherwise unmount the subtree it was supposed to protect.
 */
export const reportFromErrorBoundary = (
  reporter: CrashReporterPort,
  error: Error,
  info: { componentStack?: string | null },
  options: BoundaryReportOptions,
): void => {
  try {
    const message = error?.message ? String(error.message) : 'Unknown error';
    const stack = typeof info.componentStack === 'string' ? info.componentStack : '';
    const firstFrame = stack
      ? stack.split('\n').map((line) => line.trim()).find((line) => line.length > 0) ?? null
      : null;

    const schedule = (callback: () => void): void => {
      try {
        queueMicrotask(callback);
      } catch {
        try {
          setTimeout(callback, 0);
        } catch {
          callback();
        }
      }
    };

    schedule(() => {
      try {
        void reporter.reportCrash({
          buildSha: options.buildSha,
          occurredAt: nowIso(),
          verdict: {
            crashed: true,
            reason: `the ${options.boundary} error boundary caught`,
          },
          userAgent: safeUserAgent(),
          viewport: safeViewport(),
          performanceMode: options.performanceMode,
          errorSummary: { message, firstFrame },
          telemetryText: formatTelemetry(readTelemetry()),
          intervalsIcuAthleteId: options.intervalsIcuAthleteId ?? null,
        });
      } catch {
        // NFR2.
      }
    });
  } catch {
    // ignored
  }
};
