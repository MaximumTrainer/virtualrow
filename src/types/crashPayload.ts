/**
 * The crash-report payload shape (issue #473, FR4).
 *
 * The ONLY fields that leave the browser. The redactor in
 * `src/utils/crashRedactor.ts` is a deep allowlist against this shape — any
 * key not listed here is stripped before transport, so adding a field here
 * is also adding it to the whitelist.
 *
 * Nothing identifying: no `email`, `access_token`, `refresh_token`, display
 * name, raw `window.location.href`, cookie, localStorage dump, workout
 * content, or route id/name. `intervalsIcuAthleteId` is the one exception
 * (D2 = b), opaque numeric only.
 */
import type { PerformanceMode } from '../components/rower3d/constants';

export const CRASH_PAYLOAD_SCHEMA_VERSION = 1 as const;

/**
 * The verdict `describeCrashEvidence` returned. Narrowed to `crashed: true`
 * on the write path — a non-crash never produces a payload.
 */
export interface CrashVerdictPayload {
  crashed: true;
  reason: string;
}

/** The first error-shaped telemetry entry, when there was one. */
export interface CrashErrorSummary {
  message: string;
  firstFrame: string | null;
}

export interface CrashPayload {
  schemaVersion: typeof CRASH_PAYLOAD_SCHEMA_VERSION;
  /** Opaque per-browser-profile UUID (localStorage `virtualrow:crash-session-id`). */
  sessionId: string;
  /** Deploy's commit SHA from `VITE_BUILD_SHA`; `"dev"` for local builds. */
  buildSha: string;
  /** ISO-8601 UTC of when the previous run died, or when the boundary caught. */
  occurredAt: string;
  verdict: CrashVerdictPayload;
  userAgent: string;
  viewport: { w: number; h: number; dpr: number };
  performanceMode: PerformanceMode;
  errorSummary: CrashErrorSummary | null;
  /** `formatTelemetry()` output, redacted and truncated. */
  telemetryText: string;
  /**
   * The signed-in athlete's intervals.icu id, when D2 = b and the rower is
   * signed in. Opaque numeric — no display name, no token.
   */
  intervalsIcuAthleteId: string | null;
}
