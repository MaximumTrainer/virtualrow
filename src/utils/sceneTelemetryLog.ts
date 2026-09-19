// ============================================================================
// A RECORD OF WHAT THE SCENE WAS DOING, THAT OUTLIVES WHAT BROKE IT
//
// Everything the 3D view already reports — draw calls, frame pacing, context
// state, geometry, memory — is instantaneous and lives in memory. The moment
// the renderer is killed and the tab reloads, all of it goes with it.
//
// That is not hypothetical. Twice while #272 was being built, a heavy traverse
// ended with "Execution context was destroyed, most likely because of a
// navigation" and the app back at its setup view, with nothing left anywhere to
// say what had happened in the seconds before. This is the thing that would
// have said.
//
// Session storage, because it survives a reload of the same tab — which is the
// case worth catching — and is cleared when the tab closes, so a rower's
// machine does not accumulate our diagnostics for ever.
// ============================================================================

/** Where the log lives in session storage. */
export const TELEMETRY_STORAGE_KEY = 'virtualrow:scene-telemetry';

/**
 * How many events are kept.
 *
 * A ring: the oldest go first, because whatever broke is usually near the end.
 * At roughly one sample a second this is several minutes of rowing, and the
 * events that matter — a lost context, an error, a boundary — are rare enough
 * to survive alongside them.
 */
export const MAX_TELEMETRY_EVENTS = 300;

export interface TelemetryEvent {
  /** Milliseconds since the page loaded, rounded. */
  at: number;
  kind: string;
  detail?: Record<string, unknown>;
}

let events: TelemetryEvent[] = [];
let store: Storage | null = null;

/** `performance.now`, or something monotonic enough, without throwing. */
const now = (): number => {
  try {
    return Math.round(performance.now());
  } catch {
    return 0;
  }
};

/**
 * Write the log out.
 *
 * Every record, not on a timer: the whole point is that the last thing written
 * before a crash is still there afterwards, and a flush that was still pending
 * would be the one thing worth having.
 */
const flush = (): void => {
  if (!store) return;
  try {
    store.setItem(TELEMETRY_STORAGE_KEY, JSON.stringify(events));
  } catch {
    // A private window refuses, or the quota is full. Losing the log is a
    // nuisance; taking the scene down with it would not be.
  }
};

/**
 * Start recording, carrying over anything a previous run left behind.
 *
 * The previous run is the interesting one after a crash, so it is kept and a
 * `run-start` marker is appended rather than the slate being wiped.
 */
export const openTelemetry = (storage: Storage | null | undefined): void => {
  store = storage ?? null;

  let recovered: TelemetryEvent[] = [];
  try {
    const raw = store?.getItem(TELEMETRY_STORAGE_KEY);
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        recovered = parsed.filter(
          (e): e is TelemetryEvent =>
            !!e && typeof e === 'object' && typeof (e as TelemetryEvent).kind === 'string',
        );
      }
    }
  } catch {
    // Storage refused, or is holding something that is not a log. Either way
    // there is nothing to recover and a fresh one is the right answer.
    recovered = [];
  }

  events = recovered;
  recordTelemetry('run-start', {
    href: typeof location !== 'undefined' ? location.pathname : undefined,
    recovered: recovered.length,
  });
};

/** Note that something happened. */
export const recordTelemetry = (kind: string, detail?: Record<string, unknown>): void => {
  events.push({ at: now(), kind, ...(detail ? { detail } : {}) });
  if (events.length > MAX_TELEMETRY_EVENTS) {
    events = events.slice(events.length - MAX_TELEMETRY_EVENTS);
  }
  flush();
};

/** Everything recorded, oldest first. */
export const readTelemetry = (): TelemetryEvent[] => [...events];

/** Forget it, in memory and in storage. */
export const clearTelemetry = (): void => {
  events = [];
  try {
    store?.removeItem(TELEMETRY_STORAGE_KEY);
  } catch {
    // Nothing to do about it.
  }
  store = null;
};

/**
 * The log as text, one event per line.
 *
 * For pasting into an issue, which is what it is for — a wall of JSON is worse
 * than useless in a bug report.
 */
export const telemetryAsText = (): string =>
  readTelemetry()
    .map((e) => {
      const seconds = (e.at / 1000).toFixed(1).padStart(7, ' ');
      const detail = e.detail ? ` ${JSON.stringify(e.detail)}` : '';
      return `${seconds}s  ${e.kind}${detail}`;
    })
    .join('\n');
