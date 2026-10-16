/**
 * The ONLY path crash telemetry takes out of the browser (issue #473, FR6).
 *
 * A pure function so it is testable without a browser and cannot drift from
 * the gate the service applies. Deep allowlist against `CrashPayload`, not a
 * denylist, so a field added upstream by accident is dropped before transport
 * rather than leaked. The free-form `telemetryText` is scrubbed with three
 * narrow regexes — token-shaped runs, email-shaped runs, lat/lng-shaped
 * substrings — and anything over 8 KB per field is truncated.
 *
 * The reporter calls this on every outgoing payload; the fetch call site in
 * `crashReporterService.ts` reads only what this returns.
 */
import {
  CRASH_PAYLOAD_SCHEMA_VERSION,
  type AuthFailureDetail,
  type CrashKind,
  type CrashPayload,
  type CrashErrorSummary,
  type CrashVerdictPayload,
} from '../types/crashPayload';
import type { PerformanceMode } from '../components/rower3d/constants';

/** Match "20+ characters of base64/url-safe id-ish" — the shape tokens have. */
const TOKEN_PATTERN = /[A-Za-z0-9_-]{20,}/g;

/** RFC-5322-lite. Narrow enough to miss `[REDACTED]` and the schema version. */
const EMAIL_PATTERN = /[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi;

/**
 * "A pair of lat/lng-looking decimals". Four decimals is ~11 m resolution, so
 * two integers and three decimals apart on each side are safely "not a route
 * position" — a draw-call count is spared, an olympic rowing lane is not.
 */
const LATLNG_PATTERN = /-?\d{1,2}\.\d{4,}, ?-?\d{1,3}\.\d{4,}/g;

/** Per-field cap, chosen so a worst-case telemetry log still fits one dispatch. */
export const PER_FIELD_MAX_BYTES = 8 * 1024;

const PERFORMANCE_MODES: readonly PerformanceMode[] = [
  'basic',
  'low',
  'medium',
  'high',
  'extra-high',
];

const CRASH_KINDS: readonly CrashKind[] = [
  'crash',
  'oauth-token-exchange',
  'oauth-profile-fetch',
];

/**
 * Allowed shape of an OAuth `error` body code. Narrow enough that a stray
 * display name or secret cannot land in this field, broad enough to accept
 * `invalid_client`, `invalid_grant`, `unauthorized_client`, etc.
 */
const AUTH_ERROR_CODE_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;

export const REDACTED = '[REDACTED]';

/** The one place telemetry text is scrubbed for identifiers. */
export const redactText = (text: string): string =>
  text
    .replace(EMAIL_PATTERN, REDACTED)
    .replace(LATLNG_PATTERN, REDACTED)
    .replace(TOKEN_PATTERN, REDACTED);

/**
 * Truncate a string field with the stated suffix if it is over the cap.
 *
 * UTF-16 code units ≈ bytes closely enough for the gate — the proxy enforces
 * its own cap server-side (FR6).
 */
export const truncateField = (text: string, max = PER_FIELD_MAX_BYTES): string =>
  text.length <= max ? text : `${text.slice(0, max)}\n… [truncated at ${max} B]`;

const toFinitePositiveNumber = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return 0;
  return value;
};

const toSafeString = (value: unknown, max: number): string => {
  if (typeof value !== 'string') return '';
  return truncateField(value, max);
};

const toPerformanceMode = (value: unknown): PerformanceMode =>
  typeof value === 'string' && (PERFORMANCE_MODES as readonly string[]).includes(value)
    ? (value as PerformanceMode)
    : 'medium';

const toVerdict = (value: unknown): CrashVerdictPayload => {
  const v = (value ?? {}) as Partial<CrashVerdictPayload>;
  return {
    crashed: true,
    reason: toSafeString(v.reason, 200) || 'unspecified',
  };
};

const toErrorSummary = (value: unknown): CrashErrorSummary | null => {
  if (!value || typeof value !== 'object') return null;
  const v = value as Partial<CrashErrorSummary>;
  if (typeof v.message !== 'string') return null;
  return {
    message: truncateField(redactText(v.message), 500),
    firstFrame:
      typeof v.firstFrame === 'string'
        ? truncateField(redactText(v.firstFrame), 500)
        : null,
  };
};

const toCrashKind = (value: unknown): CrashKind =>
  typeof value === 'string' && (CRASH_KINDS as readonly string[]).includes(value)
    ? (value as CrashKind)
    : 'crash';

const toAuthFailure = (value: unknown): AuthFailureDetail | null => {
  if (!value || typeof value !== 'object') return null;
  const v = value as Partial<AuthFailureDetail>;
  const anyFieldPresent =
    'status' in v || 'errorCode' in v || 'errorDescription' in v || 'networkError' in v;
  // Treat `authFailure: {}` as "no detail" — callers that genuinely want an
  // all-null failure must pass at least one key explicitly.
  if (!anyFieldPresent) return null;
  const status =
    typeof v.status === 'number' && Number.isFinite(v.status) && v.status >= 100 && v.status <= 599
      ? Math.trunc(v.status)
      : null;
  const errorCode =
    typeof v.errorCode === 'string' && AUTH_ERROR_CODE_PATTERN.test(v.errorCode)
      ? v.errorCode
      : null;
  const errorDescription =
    typeof v.errorDescription === 'string'
      ? truncateField(redactText(v.errorDescription), 500)
      : null;
  const networkError = typeof v.networkError === 'boolean' ? v.networkError : false;
  return { status, errorCode, errorDescription, networkError };
};

const toAthleteId = (value: unknown): string | null => {
  if (typeof value !== 'string' || value.length === 0) return null;
  // Numeric ids only, so a stray display name never slips through under this key.
  if (!/^\d{1,20}$/.test(value)) return null;
  return value;
};

/**
 * Produce the exact object that goes on the wire.
 *
 * Builds a fresh object field by field: nothing from `input` reaches the
 * output except through a typed accessor above.
 */
export const redactCrashPayload = (input: Partial<CrashPayload>): CrashPayload => {
  const viewport = (input.viewport ?? {}) as Partial<CrashPayload['viewport']>;
  const telemetryText = toSafeString(input.telemetryText, 16 * 1024);
  return {
    schemaVersion: CRASH_PAYLOAD_SCHEMA_VERSION,
    kind: toCrashKind(input.kind),
    sessionId: toSafeString(input.sessionId, 200),
    buildSha: toSafeString(input.buildSha, 100) || 'dev',
    occurredAt: toSafeString(input.occurredAt, 50),
    verdict: toVerdict(input.verdict),
    userAgent: toSafeString(input.userAgent, 200),
    viewport: {
      w: Math.round(toFinitePositiveNumber(viewport.w)),
      h: Math.round(toFinitePositiveNumber(viewport.h)),
      dpr: toFinitePositiveNumber(viewport.dpr),
    },
    performanceMode: toPerformanceMode(input.performanceMode),
    errorSummary: toErrorSummary(input.errorSummary),
    telemetryText: redactText(telemetryText),
    intervalsIcuAthleteId: toAthleteId(input.intervalsIcuAthleteId),
    authFailure: toAuthFailure(input.authFailure),
  };
};
