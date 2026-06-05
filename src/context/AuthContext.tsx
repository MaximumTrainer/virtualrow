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
  /** Start the OAuth login flow (redirects the browser). */
  login: () => Promise<void>;
  /** Sign out: clears tokens and resets auth state. */
  logout: () => void;
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
  login: async () => {},
  logout: () => {},
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
  const [pendingAction, setPendingAction] = useState<string | null>(null);

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

    // Strip the OAuth params from the URL immediately (before async work)
    const cleanUrl = new URL(window.location.href);
    cleanUrl.searchParams.delete('code');
    cleanUrl.searchParams.delete('state');
    window.history.replaceState({}, '', cleanUrl.toString());

    setIsLoading(true);
    service.handleCallback(code, state).then((authUser) => {
      setUser(authUser);
      setIsLoading(false);
    }).catch(() => {
      setIsLoading(false);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const login = useCallback(async () => {
    await service.startLogin();
  }, [service]);

  const logout = useCallback(() => {
    service.logout();
    setUser(null);
    setPendingAction(null);
  }, [service]);

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated: user !== null,
        isLoading,
        login,
        logout,
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
