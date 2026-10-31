/**
 * AuthService — OAuth 2.0 authorization code flow with PKCE for intervals.icu.
 *
 * Security model:
 *  - Access token is stored in memory only (never persisted).
 *  - Refresh token is stored in sessionStorage (cleared on tab close).
 *  - User/athlete profile is stored in an encrypted cookie (2h TTL, refreshed
 *    on reload) so the app can recover login state without persisting tokens.
 *  - State parameter provides CSRF protection.
 *  - PKCE S256 challenge replaces client secret for this public SPA client.
 *
 * The intervals.icu OAuth endpoints are accessed via the CORS proxy:
 *   https://mt-intervals-proxy.intervals-login.workers.dev/proxy/<path>
 *
 * Environment variable required:
 *   VITE_INTERVALS_CLIENT_ID — OAuth client ID registered with intervals.icu
 */

import type { AuthUser, OAuthTokens } from '../types/index';
import { generateCodeVerifier, generateCodeChallenge, generateState } from '../utils/pkce';
import type { AuthFailureDetail, CrashKind } from '../types/crashPayload';
import { crashReporterService } from './crashReporterService';

/**
 * Classified authentication-error reason the UI reads to pick its copy +
 * whether a Retry button is shown (#486 Phase 2 FR2, D2 = a).
 *
 *  - `config`      — intervals.icu rejected the client (invalid_client).
 *                    Not recoverable from a retry; the UI omits the button.
 *  - `transient`   — proxy / upstream 5xx. Retry is appropriate.
 *  - `expired-code`— the authorisation code was reused or has expired
 *                    (invalid_grant). Retry re-starts the OAuth flow.
 *  - `network`     — `fetch` threw (CORS block, offline). Retry fits.
 *  - `csrf`        — state / verifier was lost from sessionStorage (not a
 *                    server failure; existing user-facing wording is kept).
 *  - `unknown`     — nothing above matched. Retry is offered.
 */
export type AuthErrorClass =
  | 'config'
  | 'transient'
  | 'expired-code'
  | 'network'
  | 'csrf'
  | 'unknown';

/** Error classes the UI should offer Retry for (#486 Phase 2 FR3). */
export const RETRYABLE_AUTH_ERROR_CLASSES: ReadonlySet<AuthErrorClass> = new Set<AuthErrorClass>([
  'transient',
  'expired-code',
  'network',
  'unknown',
]);

export const PROXY_BASE = 'https://mt-intervals-proxy.intervals-login.workers.dev/proxy';
const ICU_AUTHORIZE_URL = 'https://intervals.icu/oauth/authorize';
const ICU_TOKEN_PATH = '/api/oauth/token';
export const ICU_PROFILE_PATH = '/api/v1/athlete';

// sessionStorage keys — scoped to VirtualRow to avoid collisions
const SK_CODE_VERIFIER = 'vr_auth_code_verifier';
const SK_STATE = 'vr_auth_state';
const SK_REFRESH_TOKEN = 'vr_auth_refresh_token';
const SK_SESSION_KEY = 'vr_auth_session_key';
const SK_USER = 'vr_auth_user';
const CK_SESSION = 'vr_auth_session';
const AUTH_COOKIE_TTL_SECONDS = 2 * 60 * 60;
const AUTH_COOKIE_TTL_MS = AUTH_COOKIE_TTL_SECONDS * 1000;

interface AuthCookiePayload {
  user: AuthUser;
  athleteId: string;
  expiresAt: number;
}

function getClientId(): string {
  const id = import.meta.env.VITE_INTERVALS_CLIENT_ID as string | undefined;
  if (!id) {
    throw new Error(
      'VITE_INTERVALS_CLIENT_ID is not set. ' +
      'Add it to your .env.local file to enable intervals.icu login.'
    );
  }
  return id;
}

function getRedirectUri(): string {
  if (typeof window === 'undefined') return '';
  // import.meta.env.BASE_URL is set by Vite at build time (e.g. '/virtualrow/app/'
  // in production, '/' in development).  Using it here gives a stable redirect
  // URI regardless of which page the user happens to be on when they click login.
  const base = (import.meta.env.BASE_URL as string).replace(/\/$/, '') + '/';
  return window.location.origin + base + 'auth/callback/';
}

function getTokenProxyUrl(clientId: string): string {
  const params = new URLSearchParams({ client_id: clientId });
  return `${PROXY_BASE}${ICU_TOKEN_PATH}?${params.toString()}`;
}

interface RawTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
  /** intervals.icu returns the athlete ID as a numeric integer (e.g. 12345, not 'i12345'). */
  athlete_id?: string | number;
  /** intervals.icu may return athlete ID as part of the token response (numeric, same format as athlete_id). */
  id?: string | number;
}

interface RawAthleteProfile {
  id?: string | number;
  name?: string;
  firstname?: string;
  lastname?: string;
  first_name?: string;
  last_name?: string;
  email?: string;
  avatar?: string;
  avatarUrl?: string;
  /** intervals.icu returns "M" / "F" (case-insensitive); may be absent. */
  sex?: string;
}

/** Map the intervals.icu `sex` field ("M"/"F") to the app's gender, or undefined. */
export function genderFromSex(sex?: string | null): 'male' | 'female' | undefined {
  const s = sex?.trim().toLowerCase();
  if (s === 'm' || s === 'male') return 'male';
  if (s === 'f' || s === 'female') return 'female';
  return undefined;
}

export class AuthService {
  /** Access token held in memory only — never written to any storage. */
  private accessToken: string | null = null;
  /** Cached user object (also persisted to sessionStorage as JSON). */
  private currentUser: AuthUser | null = null;
  /** Latest callback/login error intended for UI display. */
  private lastError: string | null = null;
  /** Latest classified error reason (#486 Phase 2 FR2, D2 = a). */
  private lastErrorClass: AuthErrorClass | null = null;
  /** Handle returned by setTimeout for the silent-refresh timer. */
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.restoreSession();
  }

  // ─── Public API ────────────────────────────────────────────────────────────

  /**
   * Initiate the OAuth login flow.
   * Generates PKCE verifier + challenge and state, stores them in
   * sessionStorage, then redirects the browser to intervals.icu.
   */
  async startLogin(): Promise<void> {
    this.lastError = null;
    this.lastErrorClass = null;
    const clientId = getClientId();
    const verifier = generateCodeVerifier();
    const challenge = await generateCodeChallenge(verifier);
    const state = generateState();

    sessionStorage.setItem(SK_CODE_VERIFIER, verifier);
    sessionStorage.setItem(SK_STATE, state);

    const scopes = [
      'ACTIVITY:WRITE',
      'WELLNESS:READ',
      'SETTINGS:WRITE',
      'CALENDAR:WRITE',
      'LIBRARY:READ',
    ];

    const params = new URLSearchParams({
      client_id: clientId,
      response_type: 'code',
      redirect_uri: getRedirectUri(),
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256',
    });

    // Append scope separately so that ':' separators inside each token remain
    // unencoded.  URLSearchParams encodes ':' as '%3A', which intervals.icu does
    // not accept. Colons and commas are valid unencoded in URL query strings per
    // RFC 3986 §3.4, so no encoding is required here.
    window.location.href = `${ICU_AUTHORIZE_URL}?${params.toString()}&scope=${scopes.join(',')}`;
  }

  private callbackPromise: Promise<AuthUser | null> | null = null;

  /**
   * Handle the OAuth callback after the user grants permission on intervals.icu.
   * Validates the state parameter, exchanges the code for tokens via the proxy,
   * fetches the athlete profile, and stores the result.
   *
   * @returns The authenticated user, or null if the flow failed.
   */
  async handleCallback(code: string, state: string): Promise<AuthUser | null> {
    this.lastError = null;
    this.lastErrorClass = null;
    if (this.callbackPromise) return this.callbackPromise;

    this.callbackPromise = this._doHandleCallback(code, state);
    try {
      return await this.callbackPromise;
    } finally {
      this.callbackPromise = null;
    }
  }

  private async _doHandleCallback(code: string, state: string): Promise<AuthUser | null> {
    const storedState = sessionStorage.getItem(SK_STATE);
    if (!storedState || storedState !== state) {
      console.error('[AuthService] State mismatch — possible CSRF attack');
      this.lastError = 'Sign-in failed: Your login session expired or became invalid. Please retry.';
      this.lastErrorClass = 'csrf';
      this.clearCallbackStorage();
      return null;
    }

    const verifier = sessionStorage.getItem(SK_CODE_VERIFIER);
    if (!verifier) {
      console.error('[AuthService] Missing PKCE code verifier');
      this.lastError = 'Sign-in failed: VirtualRow could not verify your login request. Please retry.';
      this.lastErrorClass = 'csrf';
      this.clearCallbackStorage();
      return null;
    }

    this.clearCallbackStorage();

    const tokens = await this.exchangeCode(code, verifier);
    if (!tokens) return null;

    const user = await this.fetchProfile(tokens.accessToken, tokens.athleteId);
    if (!user) return null;

    await this.applyTokens(tokens, user);
    return user;
  }

  /**
   * Attempt a silent token refresh using the stored refresh token.
   * Returns true on success, false otherwise.
   */
  async refreshAccessToken(): Promise<boolean> {
    const refreshToken = sessionStorage.getItem(SK_REFRESH_TOKEN);
    if (!refreshToken) return false;

    try {
      const clientId = getClientId();
      const body = new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: clientId,
      });

      const tokenProxyUrl = getTokenProxyUrl(clientId);
      const res = await fetch(tokenProxyUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      });

      if (!res.ok) {
        console.warn('[AuthService] Token refresh failed:', res.status);
        return false;
      }

      const raw = await res.json() as RawTokenResponse;
      const athleteId = this.currentUser?.id ?? String(raw.athlete_id ?? raw.id ?? '');
      const tokens = this.parseTokenResponse(raw, athleteId);
      if (!tokens) return false;

      // Keep current user; only update the access token and schedule next refresh.
      if (!this.currentUser) {
        console.warn('[AuthService] Token refreshed but no user session is available');
        return false;
      }

      await this.applyTokens(tokens, this.currentUser);
      return true;
    } catch (err) {
      console.warn('[AuthService] Token refresh error:', err);
      return false;
    }
  }

  /** Sign out: clear all stored tokens and user data, cancel refresh timer. */
  logout(): void {
    this.cancelRefreshTimer();
    this.accessToken = null;
    this.currentUser = null;
    this.lastError = null;
    this.lastErrorClass = null;
    sessionStorage.removeItem(SK_REFRESH_TOKEN);
    sessionStorage.removeItem(SK_USER);
    sessionStorage.removeItem(SK_SESSION_KEY);
    this.clearAuthCookie();
  }

  /** Returns the in-memory access token, or null if not authenticated. */
  getAccessToken(): string | null {
    return this.accessToken;
  }

  /** Returns the current authenticated user, or null. */
  getUser(): AuthUser | null {
    return this.currentUser;
  }

  /** Returns the latest user-facing auth error captured by the service. */
  getLastError(): string | null {
    return this.lastError;
  }

  /**
   * Classified reason the latest auth attempt failed, or `null` when nothing
   * went wrong. The UI uses it to pick the right copy and decide whether to
   * offer a Retry button (#486 Phase 2 FR2 / FR3).
   */
  getLastErrorClass(): AuthErrorClass | null {
    return this.lastErrorClass;
  }

  /** True when the user is authenticated and an access token is available. */
  get isAuthenticated(): boolean {
    return this.accessToken !== null && this.currentUser !== null;
  }

  // ─── Internal helpers ──────────────────────────────────────────────────────

  /** Exchange the authorization code for tokens via the CORS proxy. */
  private async exchangeCode(code: string, verifier: string): Promise<OAuthTokens | null> {
    try {
      const clientId = getClientId();
      const body = new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: getRedirectUri(),
        client_id: clientId,
        code_verifier: verifier,
      });

      const tokenProxyUrl = getTokenProxyUrl(clientId);
      const res = await fetch(tokenProxyUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      });

      if (!res.ok) {
        console.error('[AuthService] Token exchange failed:', res.status);
        const { code: errorCode, description } = await readAuthErrorBody(res);
        const klass = classifyExchangeFailure(res.status, errorCode);
        this.lastError = messageForClass(klass);
        this.lastErrorClass = klass;
        void reportAuthFailure('oauth-token-exchange', {
          status: res.status,
          errorCode,
          errorDescription: description,
          networkError: false,
        });
        return null;
      }

      const raw = await res.json() as RawTokenResponse;
      const athleteId = String(raw.athlete_id ?? raw.id ?? '');
      const tokens = this.parseTokenResponse(raw, athleteId);
      if (!tokens) {
        this.lastError = 'Sign-in failed: intervals.icu returned an invalid token response. Please retry.';
        this.lastErrorClass = 'transient';
        void reportAuthFailure('oauth-token-exchange', {
          status: res.status,
          errorCode: 'invalid_token_response',
          errorDescription: null,
          networkError: false,
        });
      }
      return tokens;
    } catch (err) {
      console.error('[AuthService] Token exchange error:', err);
      this.lastError = 'Sign-in failed: VirtualRow could not contact intervals.icu to finish login. Please retry.';
      this.lastErrorClass = 'network';
      void reportAuthFailure('oauth-token-exchange', {
        status: null,
        errorCode: null,
        errorDescription: null,
        networkError: true,
      });
      return null;
    }
  }

  /** Fetch the current athlete profile from the intervals.icu API via proxy. */
  private async fetchProfile(accessToken: string, athleteId?: string): Promise<AuthUser | null> {
    try {
      const profilePaths = this.getProfilePaths(athleteId);

      for (const [index, profilePath] of profilePaths.entries()) {
        const res = await fetch(`${PROXY_BASE}${profilePath}`, {
          headers: { Authorization: 'Bearer '.concat(accessToken) },
        });

        if (!res.ok) {
          console.error('[AuthService] Profile fetch failed:', res.status, profilePath);
          const canFallback = this.shouldAttemptProfileFallback(index, res.status, profilePaths.length);
          if (canFallback) continue;

          const { code: errorCode, description } = await readAuthErrorBody(res);
          this.lastError = res.status === 401
            ? 'Sign-in failed: Your intervals.icu session was not authorized. Please retry.'
            : 'Sign-in failed: VirtualRow could not load your intervals.icu profile. Please retry.';
          this.lastErrorClass = res.status >= 500 ? 'transient' : res.status === 401 ? 'expired-code' : 'unknown';
          void reportAuthFailure('oauth-profile-fetch', {
            status: res.status,
            errorCode,
            errorDescription: description,
            networkError: false,
          }, athleteId);
          return null;
        }

        const raw = await res.json() as RawAthleteProfile;
        if (raw.id == null) {
          console.error('[AuthService] Profile response missing athlete ID');
          continue;
        }

        const resolvedAthleteId = String(raw.id);
        const fullName = [
          raw.firstname?.trim() || raw.first_name?.trim(),
          raw.lastname?.trim() || raw.last_name?.trim(),
        ]
          .filter(Boolean)
          .join(' ');
        const name = raw.name?.trim()
          || fullName
          || raw.email?.trim()
          || `Athlete ${resolvedAthleteId}`;

        return {
          id: resolvedAthleteId,
          name,
          email: raw.email ?? '',
          avatarUrl: raw.avatar ?? raw.avatarUrl,
          gender: genderFromSex(raw.sex),
        };
      }

      this.lastError = 'Sign-in failed: VirtualRow could not load your intervals.icu profile. Please retry.';
      this.lastErrorClass = 'unknown';
      void reportAuthFailure('oauth-profile-fetch', {
        status: null,
        errorCode: 'profile_missing_id',
        errorDescription: null,
        networkError: false,
      }, athleteId);
      return null;
    } catch (err) {
      console.error('[AuthService] Profile fetch error:', err);
      this.lastError = 'Sign-in failed: VirtualRow could not load your intervals.icu profile. Please retry.';
      this.lastErrorClass = 'network';
      void reportAuthFailure('oauth-profile-fetch', {
        status: null,
        errorCode: null,
        errorDescription: null,
        networkError: true,
      }, athleteId);
      return null;
    }
  }

  private parseTokenResponse(raw: RawTokenResponse, athleteId: string): OAuthTokens | null {
    if (!raw.access_token) return null;
    return {
      accessToken: raw.access_token,
      refreshToken: raw.refresh_token,
      expiresIn: raw.expires_in,
      expiresAt: Date.now() + raw.expires_in * 1000,
      tokenType: raw.token_type ?? 'Bearer',
      athleteId,
    };
  }

  /**
   * Store tokens and user, schedule silent refresh 60 seconds before expiry.
   */
  private async applyTokens(tokens: OAuthTokens, user: AuthUser): Promise<void> {
    this.accessToken = tokens.accessToken;
    this.currentUser = user;

    if (tokens.refreshToken) {
      sessionStorage.setItem(SK_REFRESH_TOKEN, tokens.refreshToken);
    }
    sessionStorage.setItem(SK_USER, JSON.stringify(user));
    await this.persistCookieSession(user);

    this.scheduleRefresh(tokens.expiresAt);
  }

  /**
   * Schedule a silent token refresh 60 seconds before the access token expires.
   * Minimum scheduling window: 10 seconds from now.
   */
  scheduleRefresh(expiresAt: number): void {
    this.cancelRefreshTimer();
    const msUntilExpiry = expiresAt - Date.now();
    const delay = Math.max(10_000, msUntilExpiry - 60_000);
    this.refreshTimer = setTimeout(() => {
      this.refreshAccessToken().catch(console.error);
    }, delay);
  }

  private cancelRefreshTimer(): void {
    if (this.refreshTimer !== null) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  /** On construction, restore session from sessionStorage snapshot (synchronous)
   *  and use the encrypted cookie as a fallback/TTL refresh mechanism (async). */
  private restoreSession(): void {
    const userJson = sessionStorage.getItem(SK_USER);
    if (userJson) {
      try {
        this.currentUser = JSON.parse(userJson) as AuthUser;
      } catch {
        sessionStorage.removeItem(SK_USER);
      }
    }
    this.restoreSessionFromCookie().catch(console.error);
  }

  private async restoreSessionFromCookie(): Promise<void> {
    const payload = await this.readCookieSession();
    if (!payload) {
      // No valid cookie; if a user was restored synchronously from sessionStorage,
      // attempt a token refresh so the access token is available immediately.
      if (this.currentUser) {
        this.refreshAccessToken().catch(console.error);
      }
      return;
    }

    if (payload.expiresAt <= Date.now()) {
      this.clearAuthCookie();
      if (this.currentUser) {
        this.refreshAccessToken().catch(console.error);
      }
      return;
    }

    this.currentUser = payload.user;
    sessionStorage.setItem(SK_USER, JSON.stringify(payload.user));
    await this.persistCookieSession(payload.user, payload.athleteId);
    // Access token is not persisted; silently refresh to get a new one.
    this.refreshAccessToken().catch(console.error);
  }

  private async persistCookieSession(user: AuthUser, athleteId = user.id): Promise<void> {
    const sessionKey = this.getOrCreateSessionKey();
    if (!sessionKey) return;

    const payload: AuthCookiePayload = {
      user,
      athleteId,
      expiresAt: Date.now() + AUTH_COOKIE_TTL_MS,
    };

    const encrypted = await this.encryptCookiePayload(payload, sessionKey);
    if (!encrypted) return;

    this.setAuthCookie(encrypted, AUTH_COOKIE_TTL_SECONDS);
  }

  private async readCookieSession(): Promise<AuthCookiePayload | null> {
    const encrypted = this.getCookieValue(CK_SESSION);
    if (!encrypted) return null;

    const sessionKey = this.getOrCreateSessionKey();
    if (!sessionKey) return null;

    return this.decryptCookiePayload(encrypted, sessionKey);
  }

  private getOrCreateSessionKey(): string | null {
    const existing = sessionStorage.getItem(SK_SESSION_KEY);
    if (existing) return existing;

    if (typeof crypto === 'undefined' || typeof crypto.getRandomValues !== 'function') {
      console.error('[AuthService] Web Crypto unavailable: encrypted auth cookie session cannot be persisted');
      return null;
    }

    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    const key = this.bytesToBase64Url(bytes);
    sessionStorage.setItem(SK_SESSION_KEY, key);
    return key;
  }

  private async encryptCookiePayload(payload: AuthCookiePayload, keyMaterial: string): Promise<string | null> {
    if (typeof crypto === 'undefined' || !crypto.subtle) return null;

    try {
      const key = await this.deriveEncryptionKey(keyMaterial);
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const ivBytes = new Uint8Array(iv);
      const plaintext = new TextEncoder().encode(JSON.stringify(payload));
      const ciphertext = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv: ivBytes },
        key,
        plaintext,
      );
      const encryptedBytes = new Uint8Array(ciphertext);
      return `${this.bytesToBase64Url(iv)}.${this.bytesToBase64Url(encryptedBytes)}`;
    } catch {
      return null;
    }
  }

  private async decryptCookiePayload(encrypted: string, keyMaterial: string): Promise<AuthCookiePayload | null> {
    if (typeof crypto === 'undefined' || !crypto.subtle) return null;

    const [encodedIv, encodedCiphertext] = encrypted.split('.');
    if (!encodedIv || !encodedCiphertext) return null;

    try {
      const iv = this.base64UrlToBytes(encodedIv);
      const ciphertext = this.base64UrlToBytes(encodedCiphertext);
      const ivBytes = new Uint8Array(iv);
      const ciphertextBytes = new Uint8Array(ciphertext);
      const key = await this.deriveEncryptionKey(keyMaterial);
      const plaintext = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: ivBytes },
        key,
        ciphertextBytes,
      );
      const decoded = JSON.parse(new TextDecoder().decode(plaintext)) as AuthCookiePayload;
      if (!decoded?.user?.id || !decoded?.athleteId || typeof decoded.expiresAt !== 'number') {
        return null;
      }
      return decoded;
    } catch {
      return null;
    }
  }

  private async deriveEncryptionKey(keyMaterial: string): Promise<CryptoKey> {
    const hashed = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(keyMaterial));
    return crypto.subtle.importKey(
      'raw',
      hashed,
      { name: 'AES-GCM' },
      false,
      ['encrypt', 'decrypt'],
    );
  }

  private setAuthCookie(value: string, maxAgeSeconds: number): void {
    // HttpOnly cannot be set here because this SPA must read/decrypt the cookie
    // in-browser to restore auth state after reload.
    const secure = window.location.protocol === 'https:' ? '; Secure' : '';
    document.cookie = `${CK_SESSION}=${encodeURIComponent(value)}; Max-Age=${maxAgeSeconds}; Path=/; SameSite=Lax${secure}`;
  }

  private clearAuthCookie(): void {
    document.cookie = `${CK_SESSION}=; Max-Age=0; Path=/; SameSite=Lax`;
  }

  private getCookieValue(name: string): string | null {
    const prefix = `${name}=`;
    const entry = document.cookie.split('; ').find((cookie) => cookie.startsWith(prefix));
    if (!entry) return null;
    return decodeURIComponent(entry.slice(prefix.length));
  }

  private bytesToBase64Url(bytes: Uint8Array): string {
    const chars: string[] = [];
    for (let i = 0; i < bytes.length; i += 1) {
      chars.push(String.fromCharCode(bytes[i]));
    }
    return btoa(chars.join('')).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  }

  private base64UrlToBytes(value: string): Uint8Array {
    const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }

  private clearCallbackStorage(): void {
    sessionStorage.removeItem(SK_CODE_VERIFIER);
    sessionStorage.removeItem(SK_STATE);
  }

  private getProfilePaths(athleteId?: string): string[] {
    if (!athleteId) {
      // When the token response omits athlete_id, intervals.icu supports /athlete/0
      // as a Bearer-authenticated alias for the current OAuth athlete.
      return [`${ICU_PROFILE_PATH}/0`];
    }
    const paths = [`${ICU_PROFILE_PATH}/${encodeURIComponent(athleteId)}`];
    // intervals.icu returns athlete_id as a plain integer in the token response
    // (e.g. 12345) but the REST API requires the 'i'-prefixed form for internal
    // athletes (e.g. i12345). When the stored ID is purely numeric, append the
    // 'i'-prefixed variant as a 404-triggered fallback.
    if (/^\d+$/.test(athleteId)) {
      paths.push(`${ICU_PROFILE_PATH}/i${athleteId}`);
    }
    return paths;
  }

  private shouldAttemptProfileFallback(index: number, status: number, pathCount: number): boolean {
    return index === 0 && status === 404 && pathCount > 1;
  }
}

export const authService = new AuthService();

/**
 * Classify an OAuth token-exchange failure (#486 Phase 2 FR2, D2 = a).
 *
 * The classifier is a pure function so tests pin every mapping without
 * reaching into AuthService internals.
 *
 *  - 400/401 `invalid_client` → `config` (no retry; VirtualRow isn't
 *    registered or its client secret rotated upstream).
 *  - 400/401 `invalid_grant`  → `expired-code` (replayed / expired code,
 *    retry re-starts OAuth).
 *  - 500–599 OR 408 OR 429    → `transient` (retry fits).
 *  - Any other 400/401 with no OAuth code → `unknown` (retry fits).
 */
export function classifyExchangeFailure(
  status: number,
  errorCode: string | null,
): AuthErrorClass {
  if (errorCode === 'invalid_client') return 'config';
  if (errorCode === 'invalid_grant') return 'expired-code';
  if (status >= 500 || status === 408 || status === 429) return 'transient';
  return 'unknown';
}

/**
 * The user-visible copy for each classified failure (#486 Phase 2 FR2).
 * Kept with the classifier so adding a class in one place doesn't break the
 * UI. `AuthButton` passes `lastError` as `fallback` for backward compat with
 * tests pinning the old wording when they drive the service directly.
 */
export function messageForClass(klass: AuthErrorClass): string {
  switch (klass) {
    case 'config':
      return "Sign-in failed: VirtualRow isn't registered with intervals.icu — please report this.";
    case 'expired-code':
      return 'Sign-in failed: Your sign-in link expired — please sign in again.';
    case 'transient':
      return 'Sign-in failed: intervals.icu is temporarily unavailable. Please retry in a moment.';
    case 'network':
      return 'Sign-in failed: VirtualRow could not contact intervals.icu to finish login. Please retry.';
    case 'csrf':
      return 'Sign-in failed: Your login session expired or became invalid. Please retry.';
    case 'unknown':
    default:
      return 'Sign-in failed: VirtualRow could not exchange your intervals.icu authorization code. Please retry.';
  }
}

/**
 * Read the OAuth error body (RFC 6749 §5.2) without blowing up on an empty,
 * non-JSON or already-consumed response.
 *
 * Returns at most `{code, description}` — `code` is only kept when it matches
 * the redactor's `AUTH_ERROR_CODE_PATTERN` so a server echoing user input
 * cannot slip identifiers into the crash payload. The redactor applies the
 * same gate as a second line of defence (#486 NFR1).
 */
async function readAuthErrorBody(
  res: Response,
): Promise<{ code: string | null; description: string | null }> {
  try {
    const contentType = res.headers.get('content-type') ?? '';
    if (!contentType.toLowerCase().includes('json')) {
      return { code: null, description: null };
    }
    const body = (await res.json()) as unknown;
    if (!body || typeof body !== 'object') return { code: null, description: null };
    const b = body as { error?: unknown; error_description?: unknown };
    const code =
      typeof b.error === 'string' && /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(b.error)
        ? b.error
        : null;
    const description = typeof b.error_description === 'string' ? b.error_description : null;
    return { code, description };
  } catch {
    return { code: null, description: null };
  }
}

/**
 * Dispatch a structured OAuth failure through the #473 crash transport
 * (#486 FR1, D3 = a). The call is intentionally fire-and-forget — the
 * reporter never throws (NFR2 of #473) and sign-in has already failed, so
 * waiting on it would only delay the user-facing error message.
 *
 * The `errorSummary` is set so the dedup signature (`buildSignature`) is
 * stable per `(kind, status, errorCode)` tuple without reaching into the
 * reporter.
 */
function reportAuthFailure(
  kind: Extract<CrashKind, 'oauth-token-exchange' | 'oauth-profile-fetch'>,
  detail: AuthFailureDetail,
  athleteId?: string,
): Promise<unknown> {
  try {
    const statusLabel = detail.networkError
      ? 'network-error'
      : detail.status !== null
        ? `status=${detail.status}`
        : 'status=unknown';
    const message = `${kind} ${statusLabel}`;
    const firstFrame = detail.errorCode ? `error=${detail.errorCode}` : null;
    return crashReporterService
      .reportCrash({
        kind,
        verdict: { crashed: true, reason: kind },
        errorSummary: { message, firstFrame },
        authFailure: detail,
        intervalsIcuAthleteId: athleteId && /^\d{1,20}$/.test(athleteId) ? athleteId : null,
        occurredAt: new Date().toISOString(),
        userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
        viewport:
          typeof window !== 'undefined'
            ? { w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio ?? 1 }
            : { w: 0, h: 0, dpr: 1 },
      })
      // Fire-and-forget: swallow a reporter rejection so a sign-in failure
      // never surfaces a second unrelated error through the AuthProvider.
      // The reporter itself keeps the error in `getLastSubmissionError()`.
      .catch(() => undefined);
  } catch {
    // The reporter itself is a defensive singleton, but belt-and-braces so a
    // boot-time import failure can never promote a sign-in failure into a
    // throw across the AuthProvider.
    return Promise.resolve();
  }
}
