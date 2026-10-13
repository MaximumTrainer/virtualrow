/**
 * Crash telemetry reporter (issue #473, FR3 / FR5 / FR7 / FR10).
 *
 * Phase 1 ships the port, redaction, dedupe (FR7), rate limits (FR7), opt-out
 * (FR8) and a stub transport that only `console.info`s the payload. The real
 * `repository_dispatch` POST (D1 = a) lands in Phase 3; wiring the port here
 * now means Phase 2 can call `reportCrash` on boot and from the error
 * boundary without touching call-sites again.
 *
 * The service never throws into a React render path or the physics loop
 * (NFR2): every public method catches, every write to storage catches, every
 * transport failure is swallowed into `getLastSubmissionError()`.
 */
import { redactCrashPayload } from '../utils/crashRedactor';
import {
  crashReportsPreferenceStore,
  type CrashReportsPreferenceStore,
} from './crashReportsPreferenceStore';
import { CRASH_PAYLOAD_SCHEMA_VERSION, type CrashPayload } from '../types/crashPayload';
import { makeRepositoryDispatchTransport } from './crashReportTransport';

/** localStorage key for the per-signature last-sent timestamps (FR7). */
export const CRASH_DEDUP_KEY = 'virtualrow:crash-dedup';
/** localStorage key for the opaque per-browser-profile UUID (FR4). */
export const CRASH_SESSION_ID_KEY = 'virtualrow:crash-session-id';

/** 1 submission per signature per hour per profile (D6 (a)). */
export const DEDUP_WINDOW_MS = 60 * 60 * 1000;
/** 10 submissions per profile per 24h regardless of signature (D6 (b)). */
export const DAILY_CAP = 10;
export const DAILY_CAP_WINDOW_MS = 24 * 60 * 60 * 1000;
/** TTL on each dedup entry so a signature stops dominating storage. */
export const DEDUP_ENTRY_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * The reasons the service drops a submission silently. Returned so the
 * boundary / boot wiring can log one `info` locally without claiming the
 * network was called.
 */
export type DropReason =
  | 'opted-out'
  | 'duplicate-within-window'
  | 'daily-cap-reached'
  | 'no-endpoint';

export interface ReportResult {
  submitted: boolean;
  reason?: DropReason;
  signature?: string;
}

type Transport = (payload: CrashPayload) => Promise<void>;

/**
 * Phase 1 transport: never leaves the browser.
 *
 * The real transport lands in Phase 3 (D1 = a `repository_dispatch`). Picked
 * from `import.meta.env.VITE_CRASH_REPORT_ENDPOINT` and swapped in via the
 * composition root so this service stays free of transport knowledge.
 */
/** Where the Playwright e2e spec sees captured payloads (test-only hook). */
export const CAPTURED_PAYLOADS_KEY = '__VIRTUALROW_CAPTURED_CRASHES__';

/**
 * FR10 retry schedule. Two retries at 2s and 6s after the first attempt;
 * after the third failure the payload is dropped on the floor (a crash
 * report is point-in-time, so persisting it would re-send stale state).
 */
export const RETRY_DELAYS_MS: readonly number[] = [2_000, 6_000];

/**
 * True when a Playwright spec has seeded the capture array. Production never
 * sets it, so this is a narrow test seam: it also lets a build without
 * `VITE_CRASH_REPORT_ENDPOINT` reach the stub transport under the e2e.
 */
const hasCaptureSeam = (): boolean => {
  try {
    const w = globalThis as unknown as Record<string, unknown>;
    return Array.isArray(w[CAPTURED_PAYLOADS_KEY]);
  } catch {
    return false;
  }
};

export const stubConsoleTransport: Transport = async (payload) => {
  console.info('[crash-reporter] (stub) would dispatch', payload);
  // Test hook: when a Playwright spec seeds this array, the stub transport
  // appends every would-be dispatch for the spec to assert on. Production never
  // sets it, so the branch is a no-op outside the test. The property is
  // deliberately not typed on `window` — this is a narrow test seam, not an
  // API, and the e2e reads it through `page.evaluate` with its own cast.
  try {
    const w = globalThis as unknown as Record<string, unknown>;
    const captured = w[CAPTURED_PAYLOADS_KEY];
    if (Array.isArray(captured)) {
      captured.push(payload);
    }
  } catch {
    // ignored
  }
};

interface DedupMap {
  [signature: string]: number;
}

const now = (): number => {
  try {
    return Date.now();
  } catch {
    return 0;
  }
};

const safeRead = (key: string): string | null => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};

const safeWrite = (key: string, value: string): void => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // A private window, blocked site data, or quota full. Dedup is a nicety;
    // a crash report that is sent twice is worse than one that is sent, so a
    // storage failure must not block the submission.
  }
};

const readDedupMap = (): DedupMap => {
  const raw = safeRead(CRASH_DEDUP_KEY);
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: DedupMap = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
};

const writeDedupMap = (map: DedupMap, nowMs: number): void => {
  // TTL sweep so a stuck entry never lives for ever.
  const fresh: DedupMap = {};
  for (const [k, v] of Object.entries(map)) {
    if (nowMs - v < DEDUP_ENTRY_TTL_MS) fresh[k] = v;
  }
  safeWrite(CRASH_DEDUP_KEY, JSON.stringify(fresh));
};

const uuid = (): string => {
  try {
    const g = globalThis as unknown as { crypto?: { randomUUID?: () => string } };
    if (g.crypto?.randomUUID) return g.crypto.randomUUID();
  } catch {
    // ignored
  }
  // Fallback — not a cryptographic UUID, but opaque enough for a browser id.
  return `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
};

/** Build the FR7 signature from the fields that identify a crash cause. */
export const buildSignature = (payload: {
  errorSummary: CrashPayload['errorSummary'];
  userAgent: string;
}): string => {
  const message = payload.errorSummary?.message ?? 'nocrash';
  const frame = payload.errorSummary?.firstFrame ?? 'noframe';
  const ua = (payload.userAgent || 'ua').split(' ')[0];
  return `${message}|${frame}|${ua}`;
};

/** Options wired by the composition root; every one is optional in tests. */
export interface CrashReporterOptions {
  transport?: Transport;
  preferences?: CrashReportsPreferenceStore;
  /** For tests — override the clock. */
  nowFn?: () => number;
  /** `VITE_CRASH_REPORT_ENDPOINT`; empty / undefined disables the real transport (FR5). */
  endpoint?: string | null;
  /**
   * For tests — override the retry sleep. Production uses `setTimeout`;
   * Vitest passes a mock so the retry test does not actually sleep 8s.
   */
  sleepFn?: (ms: number) => Promise<void>;
  /** For tests — override the retry schedule (empty disables retries). */
  retryDelaysMs?: readonly number[];
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    try {
      setTimeout(resolve, ms);
    } catch {
      resolve();
    }
  });

export class CrashReporterService {
  private readonly transport: Transport;
  private readonly preferences: CrashReportsPreferenceStore;
  private readonly nowFn: () => number;
  private readonly hasEndpoint: boolean;
  private readonly sleepFn: (ms: number) => Promise<void>;
  private readonly retryDelaysMs: readonly number[];
  private lastSubmissionError: string | null = null;

  constructor(options: CrashReporterOptions = {}) {
    this.transport = options.transport ?? stubConsoleTransport;
    this.preferences = options.preferences ?? crashReportsPreferenceStore;
    this.nowFn = options.nowFn ?? now;
    this.hasEndpoint =
      options.endpoint === undefined
        ? true // in tests a custom transport counts as "endpoint"
        : Boolean(options.endpoint);
    this.sleepFn = options.sleepFn ?? defaultSleep;
    this.retryDelaysMs = options.retryDelaysMs ?? RETRY_DELAYS_MS;
  }

  /** The opaque per-profile UUID (FR4). Lazily created on first use. */
  getSessionId(): string {
    const existing = safeRead(CRASH_SESSION_ID_KEY);
    if (existing && existing.length > 0) return existing;
    const fresh = uuid();
    safeWrite(CRASH_SESSION_ID_KEY, fresh);
    return fresh;
  }

  /** Last transport failure, for the debug panel to render (FR10). */
  getLastSubmissionError(): string | null {
    return this.lastSubmissionError;
  }

  /**
   * Report a crash. Never throws (NFR2).
   *
   * Returns a verdict so the caller can log the drop reason locally without
   * waiting on an unrelated network call.
   */
  async reportCrash(input: Partial<CrashPayload>): Promise<ReportResult> {
    try {
      if (!this.preferences.isEnabled()) {
        return { submitted: false, reason: 'opted-out' };
      }
      if (!this.hasEndpoint && !hasCaptureSeam()) {
        return { submitted: false, reason: 'no-endpoint' };
      }

      const payload = redactCrashPayload({
        ...input,
        schemaVersion: CRASH_PAYLOAD_SCHEMA_VERSION,
        sessionId: input.sessionId ?? this.getSessionId(),
      });
      const signature = buildSignature(payload);
      const current = this.nowFn();
      const dedup = readDedupMap();

      if (
        typeof dedup[signature] === 'number' &&
        current - dedup[signature] < DEDUP_WINDOW_MS
      ) {
        return { submitted: false, reason: 'duplicate-within-window', signature };
      }

      const recentSubmissions = Object.values(dedup).filter(
        (ts) => current - ts < DAILY_CAP_WINDOW_MS,
      ).length;
      if (recentSubmissions >= DAILY_CAP) {
        return { submitted: false, reason: 'daily-cap-reached', signature };
      }

      // FR10: try once, then retry on each delay in the schedule. The last
      // error is recorded in `lastSubmissionError` for the debug panel; the
      // payload is NOT persisted after the final failure, so a crash
      // reported in a cold-network window is lost rather than being
      // re-POSTed stale from a later tab.
      let lastErr: unknown = null;
      const attempts = 1 + this.retryDelaysMs.length;
      for (let i = 0; i < attempts; i += 1) {
        if (i > 0) {
          await this.sleepFn(this.retryDelaysMs[i - 1]);
        }
        try {
          await this.transport(payload);
          dedup[signature] = current;
          writeDedupMap(dedup, current);
          this.lastSubmissionError = null;
          return { submitted: true, signature };
        } catch (err) {
          lastErr = err;
        }
      }
      this.lastSubmissionError = lastErr instanceof Error ? lastErr.message : String(lastErr);
      return { submitted: false, signature };
    } catch (err) {
      // Any surprise — redactor throw, JSON throw, listener throw — is
      // swallowed. A crash reporter that itself crashes is worse than silence.
      this.lastSubmissionError = err instanceof Error ? err.message : String(err);
      return { submitted: false };
    }
  }
}

const bakedEndpoint = readBakedEnv('VITE_CRASH_REPORT_ENDPOINT');
const bakedToken = readBakedEnv('VITE_CRASH_REPORT_TOKEN');

export const crashReporterService = new CrashReporterService({
  endpoint: bakedEndpoint,
  // When both endpoint and token are baked, swap the stub for the real
  // `repository_dispatch` transport (FR5). Missing either half leaves the
  // stub in place — the service also short-circuits on no-endpoint so no
  // POST is attempted.
  transport:
    bakedEndpoint && bakedToken
      ? makeRepositoryDispatchTransport(bakedEndpoint, bakedToken)
      : stubConsoleTransport,
});

/**
 * Read a `VITE_*` env var without blowing up when `import.meta.env` is
 * undefined (Vitest's jsdom with no define hook).
 */
function readBakedEnv(key: string): string | null {
  try {
    const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
    const value = env?.[key];
    return value && value.length > 0 ? value : null;
  } catch {
    return null;
  }
}
