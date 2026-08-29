/**
 * rownative.icu course handoff.
 *
 * VirtualRow does not reimplement course search. The user browses
 * rownative.icu — which already filters by country, status, distance band and
 * likes — and is redirected back here with the course they picked.
 *
 * Both products are intervals.icu OAuth clients (rownative is 262, VirtualRow
 * is 463) and therefore already know the same person, so the handoff carries a
 * *course identifier only*. No account linking, and no credential, is involved.
 *
 * ## Security model
 *
 * The return leg is an untrusted entry point: anyone can craft a link. So:
 *
 * - A `state` nonce is issued per attempt, stored in `sessionStorage`, and must
 *   come back unmodified and unexpired. This stops a third-party link silently
 *   loading a route into someone's session.
 * - Only a course **identifier** is accepted, never a URL to fetch, so a
 *   crafted link cannot point the app at an arbitrary host.
 * - The identifier is shape-validated before any network call.
 */
import { ROWNATIVE_ROUTE_ID_PATTERN } from '../services/rownativeService';

/** Where the user goes to browse courses. */
export const ROWNATIVE_BROWSE_URL = 'https://rownative.icu/';

/**
 * Query parameters on the return leg.
 *
 * Deliberately prefixed: a bare `state` would collide with the intervals.icu
 * OAuth callback that `AuthContext` reads from the same URL.
 */
export const HANDOFF_COURSE_PARAM = 'rownativeCourseId';
export const HANDOFF_STATE_PARAM = 'rownativeState';

/** Parameters sent *to* rownative.icu. Proposed contract — see issue #188. */
const RETURN_URL_PARAM = 'virtualrowReturn';
const RETURN_STATE_PARAM = 'virtualrowState';

const STORAGE_KEY = 'vr_rownative_handoff';
const STATE_TTL_MS = 15 * 60 * 1000;

interface StoredHandoff {
  state: string;
  issuedAt: number;
}

function generateState(): string {
  const cryptoObj = typeof globalThis !== 'undefined' ? globalThis.crypto : undefined;
  if (cryptoObj?.randomUUID) return cryptoObj.randomUUID();
  if (cryptoObj?.getRandomValues) {
    const bytes = new Uint8Array(16);
    cryptoObj.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  }
  // Last resort only — non-crypto environments (old jsdom) still get a value.
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

/** The URL VirtualRow should be sent back to, derived from the Vite base path. */
export function getReturnUrl(): string {
  if (typeof window === 'undefined') return '';
  const base = (import.meta.env.BASE_URL as string | undefined) ?? '/';
  return window.location.origin + base.replace(/\/$/, '') + '/';
}

/**
 * Begin a handoff: issue and persist a state nonce, and build the rownative.icu
 * URL to send the user to. Returns the URL to navigate to.
 */
export function startHandoff(): string {
  const state = generateState();
  if (typeof window !== 'undefined') {
    try {
      const payload: StoredHandoff = { state, issuedAt: Date.now() };
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch {
      // Private-mode storage failures shouldn't block the outbound trip; the
      // return leg will simply report an expired link.
    }
  }

  const url = new URL(ROWNATIVE_BROWSE_URL);
  url.searchParams.set(RETURN_URL_PARAM, getReturnUrl());
  url.searchParams.set(RETURN_STATE_PARAM, state);
  return url.toString();
}

/**
 * Validate and consume a returned state nonce.
 *
 * Single-use: the stored value is cleared whether or not it matched, so a
 * replayed link cannot be used twice.
 */
export function consumeHandoffState(state: string | null): boolean {
  if (typeof window === 'undefined' || !state) return false;

  let raw: string | null = null;
  try {
    raw = sessionStorage.getItem(STORAGE_KEY);
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    return false;
  }
  if (!raw) return false;

  try {
    const parsed = JSON.parse(raw) as Partial<StoredHandoff>;
    if (typeof parsed.state !== 'string' || typeof parsed.issuedAt !== 'number') return false;
    if (parsed.state !== state) return false;
    return Date.now() - parsed.issuedAt <= STATE_TTL_MS;
  } catch {
    return false;
  }
}

export interface HandoffParams {
  courseId: string;
  state: string | null;
}

/**
 * Read handoff parameters from a location search string. Returns `null` when
 * this is not a handoff return, so callers can bail without side effects.
 */
export function readHandoffParams(search: string): HandoffParams | null {
  const params = new URLSearchParams(search);
  const courseId = params.get(HANDOFF_COURSE_PARAM);
  if (!courseId) return null;
  return { courseId, state: params.get(HANDOFF_STATE_PARAM) };
}

/** Shape-check a course identifier before it reaches the network. */
export function isValidCourseId(courseId: string): boolean {
  return ROWNATIVE_ROUTE_ID_PATTERN.test(courseId.trim());
}

/**
 * Strip handoff parameters from the address bar, mirroring what `AuthContext`
 * does for the intervals.icu callback, so a refresh doesn't re-trigger a load.
 */
export function clearHandoffParams(): void {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  url.searchParams.delete(HANDOFF_COURSE_PARAM);
  url.searchParams.delete(HANDOFF_STATE_PARAM);
  window.history.replaceState({}, '', url.toString());
}

/**
 * Extract a course identifier from whatever the user pasted: a bare ID, a full
 * rownative.icu URL, or a scheme-less one such as `rownative.icu/course/5`.
 *
 * Returns `null` when the input is not a rownative reference. Hosts other than
 * rownative.icu are rejected rather than guessed at.
 */
export function parseCourseSelector(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const looksLikeUrl = trimmed.includes('://') || /^(www\.)?rownative\.icu\//i.test(trimmed);
  if (!looksLikeUrl) {
    return isValidCourseId(trimmed) ? trimmed : null;
  }

  // Normalise scheme-less input rather than rejecting it (issue #188, RS-4).
  const withScheme = trimmed.includes('://') ? trimmed : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (url.hostname !== 'rownative.icu' && url.hostname !== 'www.rownative.icu') return null;

  // Accept ?course=<id>/?id=<id>, a trailing path segment, or a #<id> fragment.
  const fromQuery = url.searchParams.get('course') ?? url.searchParams.get('id');
  if (fromQuery && isValidCourseId(fromQuery)) return fromQuery.trim();

  const segments = url.pathname.split('/').filter(Boolean);
  const lastSegment = segments[segments.length - 1]?.replace(/\.json$/i, '');
  if (lastSegment && isValidCourseId(lastSegment)) return lastSegment;

  const fragment = url.hash.replace(/^#/, '');
  if (fragment && isValidCourseId(fragment)) return fragment;

  return null;
}
