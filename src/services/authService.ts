/**
 * AuthService — OAuth 2.0 authorization code flow with PKCE for intervals.icu.
 *
 * Security model:
 *  - Access token is stored in memory only (never persisted).
 *  - Refresh token is stored in sessionStorage (cleared on tab close).
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

const PROXY_BASE = 'https://mt-intervals-proxy.intervals-login.workers.dev/proxy';
const ICU_AUTHORIZE_URL = 'https://intervals.icu/oauth/authorize';
const ICU_TOKEN_PATH = '/oauth/token';
const ICU_PROFILE_PATH = '/api/v1/athlete';

// sessionStorage keys — scoped to VirtualRow to avoid collisions
const SK_CODE_VERIFIER = 'vr_auth_code_verifier';
const SK_STATE = 'vr_auth_state';
const SK_REFRESH_TOKEN = 'vr_auth_refresh_token';
const SK_ATHLETE_ID = 'vr_auth_athlete_id';
const SK_USER = 'vr_auth_user';

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
  const { origin, pathname } = window.location;
  // Use the full origin + current path so sub-path deployments (e.g.
  // /virtualrow/app/) receive the callback at the correct URL.
  // Strip any trailing query/hash; ensure a trailing slash.
  const base = pathname.replace(/\/$/, '') + '/';
  return origin + base;
}

interface RawTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
  athlete_id?: string;
  /** intervals.icu may return athlete ID as part of the token response */
  id?: string | number;
}

interface RawAthleteProfile {
  id?: string | number;
  name?: string;
  email?: string;
  avatar?: string;
  avatarUrl?: string;
}

export class AuthService {
  /** Access token held in memory only — never written to any storage. */
  private accessToken: string | null = null;
  /** Cached user object (also persisted to sessionStorage as JSON). */
  private currentUser: AuthUser | null = null;
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
    const clientId = getClientId();
    const verifier = generateCodeVerifier();
    const challenge = await generateCodeChallenge(verifier);
    const state = generateState();

    sessionStorage.setItem(SK_CODE_VERIFIER, verifier);
    sessionStorage.setItem(SK_STATE, state);

    const url = new URL(ICU_AUTHORIZE_URL);
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('redirect_uri', getRedirectUri());
    url.searchParams.set('state', state);
    url.searchParams.set('code_challenge', challenge);
    url.searchParams.set('code_challenge_method', 'S256');

    window.location.href = url.toString();
  }

  /**
   * Handle the OAuth callback after the user grants permission on intervals.icu.
   * Validates the state parameter, exchanges the code for tokens via the proxy,
   * fetches the athlete profile, and stores the result.
   *
   * @returns The authenticated user, or null if the flow failed.
   */
  async handleCallback(code: string, state: string): Promise<AuthUser | null> {
    const storedState = sessionStorage.getItem(SK_STATE);
    if (!storedState || storedState !== state) {
      console.error('[AuthService] State mismatch — possible CSRF attack');
      this.clearCallbackStorage();
      return null;
    }

    const verifier = sessionStorage.getItem(SK_CODE_VERIFIER);
    if (!verifier) {
      console.error('[AuthService] Missing PKCE code verifier');
      this.clearCallbackStorage();
      return null;
    }

    this.clearCallbackStorage();

    const tokens = await this.exchangeCode(code, verifier);
    if (!tokens) return null;

    const user = await this.fetchProfile(tokens.athleteId, tokens.accessToken);
    if (!user) return null;

    this.applyTokens(tokens, user);
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

      const res = await fetch(`${PROXY_BASE}${ICU_TOKEN_PATH}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      });

      if (!res.ok) {
        console.warn('[AuthService] Token refresh failed:', res.status);
        return false;
      }

      const raw = await res.json() as RawTokenResponse;
      const athleteId = sessionStorage.getItem(SK_ATHLETE_ID) ?? String(raw.athlete_id ?? raw.id ?? '');
      const tokens = this.parseTokenResponse(raw, athleteId);
      if (!tokens) return false;

      // Keep current user; only update the access token and schedule next refresh
      if (this.currentUser) {
        this.applyTokens(tokens, this.currentUser);
      }
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
    sessionStorage.removeItem(SK_REFRESH_TOKEN);
    sessionStorage.removeItem(SK_ATHLETE_ID);
    sessionStorage.removeItem(SK_USER);
  }

  /** Returns the in-memory access token, or null if not authenticated. */
  getAccessToken(): string | null {
    return this.accessToken;
  }

  /** Returns the current authenticated user, or null. */
  getUser(): AuthUser | null {
    return this.currentUser;
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

      const res = await fetch(`${PROXY_BASE}${ICU_TOKEN_PATH}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      });

      if (!res.ok) {
        console.error('[AuthService] Token exchange failed:', res.status);
        return null;
      }

      const raw = await res.json() as RawTokenResponse;
      const athleteId = String(raw.athlete_id ?? raw.id ?? '');
      return this.parseTokenResponse(raw, athleteId);
    } catch (err) {
      console.error('[AuthService] Token exchange error:', err);
      return null;
    }
  }

  /** Fetch the athlete profile from the intervals.icu API via proxy. */
  private async fetchProfile(athleteId: string, accessToken: string): Promise<AuthUser | null> {
    try {
      const res = await fetch(`${PROXY_BASE}${ICU_PROFILE_PATH}/${athleteId}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (!res.ok) {
        console.error('[AuthService] Profile fetch failed:', res.status);
        return null;
      }

      const raw = await res.json() as RawAthleteProfile;
      return {
        id: String(raw.id ?? athleteId),
        name: raw.name ?? '',
        email: raw.email ?? '',
        avatarUrl: raw.avatar ?? raw.avatarUrl,
      };
    } catch (err) {
      console.error('[AuthService] Profile fetch error:', err);
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
  private applyTokens(tokens: OAuthTokens, user: AuthUser): void {
    this.accessToken = tokens.accessToken;
    this.currentUser = user;

    if (tokens.refreshToken) {
      sessionStorage.setItem(SK_REFRESH_TOKEN, tokens.refreshToken);
    }
    sessionStorage.setItem(SK_ATHLETE_ID, tokens.athleteId);
    sessionStorage.setItem(SK_USER, JSON.stringify(user));

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

  /** On construction, restore session from sessionStorage if available. */
  private restoreSession(): void {
    const userJson = sessionStorage.getItem(SK_USER);
    if (!userJson) return;
    try {
      this.currentUser = JSON.parse(userJson) as AuthUser;
      // Access token is not persisted; silently refresh to get a new one
      this.refreshAccessToken().catch(console.error);
    } catch {
      sessionStorage.removeItem(SK_USER);
    }
  }

  private clearCallbackStorage(): void {
    sessionStorage.removeItem(SK_CODE_VERIFIER);
    sessionStorage.removeItem(SK_STATE);
  }
}

export const authService = new AuthService();
