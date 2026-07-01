/**
 * AuthContext — React context for OAuth authentication state.
 *
 * Provides:
 *  - user: AuthUser | null (null = not logged in)
 *  - isAuthenticated: boolean
 *  - login(): initiate OAuth flow
 *  - logout(): sign out and clear tokens
 *  - pendingAction / setPendingAction: for the auth-gate (a guest action that
 *    was blocked and will be retried after sign-in)
 *
 * On mount, AuthProvider checks for ?code=&state= query params to complete
 * an OAuth callback, and silently restores an existing session from
 * sessionStorage.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import type { AuthUser } from '../types/index';
import { authService } from '../services/authService';

export interface AuthContextValue {
  user: AuthUser | null;
  isAuthenticated: boolean;
  /** True while the OAuth callback is being processed. */
  isLoading: boolean;
  /** Latest authentication error visible to the UI. */
  authError: string | null;
  /** Start the OAuth login flow (redirects the browser). */
  login: () => Promise<void>;
  /** Sign out: clears tokens and resets auth state. */
  logout: () => void;
  /** Clear any visible authentication error. */
  clearAuthError: () => void;
  /**
   * An action identifier that was blocked by an auth gate in guest mode.
   * After sign-in completes, the caller should retry the action.
   */
  pendingAction: string | null;
  setPendingAction: (action: string | null) => void;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  isAuthenticated: false,
  isLoading: false,
  authError: null,
  login: async () => {},
  logout: () => {},
  clearAuthError: () => {},
  pendingAction: null,
  setPendingAction: () => {},
});

export interface AuthProviderProps {
  children: ReactNode;
  /** Override for tests — injects a pre-built auth service instance. */
  service?: typeof authService;
}

export function AuthProvider({ children, service = authService }: AuthProviderProps) {
  const [user, setUser] = useState<AuthUser | null>(() => service.getUser());
  const [isLoading, setIsLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<string | null>(null);

  const clearCallbackParams = useCallback(() => {
    const cleanUrl = new URL(window.location.href);
    cleanUrl.searchParams.delete('code');
    cleanUrl.searchParams.delete('state');
    window.history.replaceState({}, '', cleanUrl.toString());
  }, []);

  // On mount: check for OAuth callback params in the URL
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    const state = params.get('state');

    if (!code || !state) {
      // No callback — restore any existing session that AuthService revived
      setUser(service.getUser());
      return;
    }

    setIsLoading(true);
    setAuthError(null);
    service.handleCallback(code, state).then((authUser) => {
      if (!authUser) {
        setAuthError(
          service.getLastError()
          ?? 'Sign-in failed: VirtualRow could not load your intervals.icu profile. Please retry.'
        );
      }

      setUser(authUser);
      setIsLoading(false);

      clearCallbackParams();
    }).catch((err: unknown) => {
      setIsLoading(false);

      setAuthError(err instanceof Error
        ? err.message
        : 'Sign-in failed: VirtualRow could not finalize your login. Please retry.');

      clearCallbackParams();
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const login = useCallback(async () => {
    setAuthError(null);
    await service.startLogin();
  }, [service]);

  const logout = useCallback(() => {
    service.logout();
    setUser(null);
    setAuthError(null);
    setPendingAction(null);
  }, [service]);

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated: user !== null,
        isLoading,
        authError,
        login,
        logout,
        clearAuthError: () => setAuthError(null),
        pendingAction,
        setPendingAction,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

/** Access the authentication context from any child component. */
export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}
