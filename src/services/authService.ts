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

export const PROXY_BASE = 'https://mt-intervals-proxy.intervals-login.workers.dev/proxy';
const ICU_AUTHORIZE_URL = 'https://intervals.icu/oauth/authorize';
const ICU_TOKEN_PATH = '/api/oauth/token';
export const ICU_PROFILE_PATH = '/api/v1/athlete';

// sessionStorage keys — scoped to VirtualRow to avoid collisions
const SK_CODE_VERIFIER = 'vr_auth_code_verifier';
const SK_STATE = 'vr_auth_state';
const SK_REFRESH_TOKEN = 'vr_auth_refresh_token';
const SK_SESSION_KEY = 'vr_auth_session_key';
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
}

export class AuthService {
  /** Access token held in memory only — never written to any storage. */
  private accessToken: string | null = null;
  /** Cached user object (also persisted to sessionStorage as JSON). */
  private currentUser: AuthUser | null = null;
  /** Latest callback/login error intended for UI display. */
  private lastError: string | null = null;
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
      this.clearCallbackStorage();
      return null;
    }

    const verifier = sessionStorage.getItem(SK_CODE_VERIFIER);
    if (!verifier) {
      console.error('[AuthService] Missing PKCE code verifier');
      this.lastError = 'Sign-in failed: VirtualRow could not verify your login request. Please retry.';
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
    sessionStorage.removeItem(SK_REFRESH_TOKEN);
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
        this.lastError = 'Sign-in failed: VirtualRow could not exchange your intervals.icu authorization code. Please retry.';
        return null;
      }

      const raw = await res.json() as RawTokenResponse;
      const athleteId = String(raw.athlete_id ?? raw.id ?? '');
      const tokens = this.parseTokenResponse(raw, athleteId);
      if (!tokens) {
        this.lastError = 'Sign-in failed: intervals.icu returned an invalid token response. Please retry.';
      }
      return tokens;
    } catch (err) {
      console.error('[AuthService] Token exchange error:', err);
      this.lastError = 'Sign-in failed: VirtualRow could not contact intervals.icu to finish login. Please retry.';
      return null;
    }
  }

  /** Fetch the current athlete profile from the intervals.icu API via proxy. */
  private async fetchProfile(accessToken: string, athleteId?: string): Promise<AuthUser | null> {
    try {
      const profilePaths = this.getProfilePaths(athleteId);

      if (profilePaths.length === 0) {
        console.error('[AuthService] Cannot fetch profile: athlete ID not available from token response');
        this.lastError = 'Sign-in failed: VirtualRow could not load your intervals.icu profile. Please retry.';
        return null;
      }

      for (const [index, profilePath] of profilePaths.entries()) {
        const res = await fetch(`${PROXY_BASE}${profilePath}`, {
          headers: { Authorization: 'Bearer '.concat(accessToken) },
        });

        if (!res.ok) {
          console.error('[AuthService] Profile fetch failed:', res.status, profilePath);
          const canFallback = this.shouldAttemptProfileFallback(index, res.status, profilePaths.length);
          if (canFallback) continue;

          this.lastError = res.status === 401
            ? 'Sign-in failed: Your intervals.icu session was not authorized. Please retry.'
            : 'Sign-in failed: VirtualRow could not load your intervals.icu profile. Please retry.';
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
        };
      }

      this.lastError = 'Sign-in failed: VirtualRow could not load your intervals.icu profile. Please retry.';
      return null;
    } catch (err) {
      console.error('[AuthService] Profile fetch error:', err);
      this.lastError = 'Sign-in failed: VirtualRow could not load your intervals.icu profile. Please retry.';
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

  /** On construction, restore session from encrypted cookie if available. */
  private restoreSession(): void {
    this.restoreSessionFromCookie().catch(console.error);
  }

  private async restoreSessionFromCookie(): Promise<void> {
    const payload = await this.readCookieSession();
    if (!payload) return;

    if (payload.expiresAt <= Date.now()) {
      this.clearAuthCookie();
      return;
    }

    this.currentUser = payload.user;
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
      // intervals.icu requires an athlete ID in the path — GET /api/v1/athlete without
      // an ID returns 405 Method Not Allowed. Return an empty list so the caller fails
      // gracefully rather than making an invalid request.
      return [];
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
