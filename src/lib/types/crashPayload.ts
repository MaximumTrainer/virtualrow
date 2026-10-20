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
import type { PerformanceMode } from '../../components/rower3d/constants';

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

/**
 * What this payload is reporting. `crash` is the renderer/boundary path from
 * #473; the OAuth kinds come from the Phase 1 of #486 and reuse the same
 * transport so one triage pipeline handles both. A kind that isn't `crash`
 * carries its structured detail in `authFailure` and leaves `errorSummary`
 * as the deduplication signature source.
 */
export type CrashKind = 'crash' | 'oauth-token-exchange' | 'oauth-profile-fetch';

/**
 * Structured intervals.icu OAuth failure context (#486 FR1). Written at the
 * four `AuthService` failure branches and read by the server-side triage.
 * NFR1: no `code`, `state`, `code_verifier`, `access_token`, `refresh_token`
 * or `Authorization` header value is ever placed in these fields — the
 * redactor's `toAuthFailure` strips anything that doesn't fit this shape.
 */
export interface AuthFailureDetail {
  /** HTTP status from the proxy, or `null` when `fetch` threw. */
  status: number | null;
  /** `body.error` for an OAuth error response (e.g. `invalid_client`), else `null`. */
  errorCode: string | null;
  /** `body.error_description` when present; redacted + truncated. */
  errorDescription: string | null;
  /** `true` when `fetch` threw (CORS block, offline); `false` for an HTTP response. */
  networkError: boolean;
}

export interface CrashPayload {
  schemaVersion: typeof CRASH_PAYLOAD_SCHEMA_VERSION;
  /**
   * What kind of event this payload reports. Defaults to `'crash'` so every
   * #473 call-site keeps its existing contract; `'oauth-*'` is set by the
   * auth-failure capture in #486 Phase 1.
   */
  kind: CrashKind;
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
  /**
   * Non-null only when `kind` is one of the `oauth-*` variants (#486). The
   * four fields are the full read of what intervals.icu / the Worker told us
   * at the failure site; nothing credential-shaped ever reaches here.
   */
  authFailure: AuthFailureDetail | null;
}
