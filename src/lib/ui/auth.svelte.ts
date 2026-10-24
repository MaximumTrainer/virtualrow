/**
 * Authentication state for the Svelte shell (#542 P1, F3).
 *
 * Ports the React `AuthProvider` / `useAuth` to a Svelte 5 runes class. The
 * shape matches the old `AuthContextValue` so components read the same fields
 * (`user`, `isAuthenticated`, `isLoading`, `authError`, `authErrorClass`,
 * `pendingAction`) and call the same methods. State lives in `$state` fields,
 * so a component that reads them re-renders when they change. The root layout
 * creates one store, provides it via {@link authContext}, and calls
 * {@link AuthStore.init} in `onMount` to complete an OAuth callback.
 */
import type { AuthUser } from '../types/index';
import { authService, type AuthErrorClass } from '../services/authService';
import type { AuthPort } from '../ports';

export class AuthStore {
  user = $state<AuthUser | null>(null);
  /** True while the OAuth callback is being processed. */
  isLoading = $state(false);
  /** Latest authentication error visible to the UI. */
  authError = $state<string | null>(null);
  /** Classified reason the latest sign-in failed (#486 Phase 2). */
  authErrorClass = $state<AuthErrorClass | null>(null);
  /**
   * An action blocked by an auth gate in guest mode. After sign-in completes
   * the caller retries it.
   */
  pendingAction = $state<string | null>(null);

  readonly #service: AuthPort;

  constructor(service: AuthPort = authService) {
    this.#service = service;
    this.user = service.getUser();
  }

  get isAuthenticated(): boolean {
    return this.user !== null;
  }

  /**
   * Complete an OAuth callback if the URL carries `?code=&state=`, otherwise
   * restore any revived session. Call once from the root layout's `onMount`.
   * Ported from the React `AuthProvider` mount effect.
   */
  init(): void {
    if (typeof window === 'undefined') return;

    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    const state = params.get('state');

    if (!code || !state) {
      this.user = this.#service.getUser();
      return;
    }

    this.isLoading = true;
    this.authError = null;
    this.authErrorClass = null;
    this.#service
      .handleCallback(code, state)
      .then((authUser) => {
        if (!authUser) {
          this.authError =
            this.#service.getLastError() ??
            'Sign-in failed: VirtualRow could not load your intervals.icu profile. Please retry.';
          this.authErrorClass = this.#service.getLastErrorClass() ?? null;
        }
        this.user = authUser;
        this.isLoading = false;
        this.#clearCallbackParams();
      })
      .catch((err: unknown) => {
        this.isLoading = false;
        this.authError =
          err instanceof Error
            ? err.message
            : 'Sign-in failed: VirtualRow could not finalize your login. Please retry.';
        // A thrown promise is an unexpected engine error, not an OAuth
        // response: fall back to the generic retryable class so the UI still
        // offers Retry.
        this.authErrorClass = 'unknown';
        this.#clearCallbackParams();
      });
  }

  async login(): Promise<void> {
    this.authError = null;
    this.authErrorClass = null;
    await this.#service.startLogin();
  }

  logout(): void {
    this.#service.logout();
    this.user = null;
    this.authError = null;
    this.authErrorClass = null;
    this.pendingAction = null;
  }

  clearAuthError(): void {
    this.authError = null;
    this.authErrorClass = null;
  }

  setPendingAction(action: string | null): void {
    this.pendingAction = action;
  }

  #clearCallbackParams(): void {
    const cleanUrl = new URL(window.location.href);
    cleanUrl.searchParams.delete('code');
    cleanUrl.searchParams.delete('state');
    window.history.replaceState({}, '', cleanUrl.toString());
  }
}
