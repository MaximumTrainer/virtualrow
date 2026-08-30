/**
 * The auth context object, its value type and the `useAuth` hook.
 *
 * Split out of AuthContext.tsx so that file exports only the provider
 * component: a module mixing components with other exports loses fast refresh
 * for the whole module.
 */
import { createContext, useContext } from 'react';
import type { AuthUser } from '../types/index';

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

export const AuthContext = createContext<AuthContextValue>({
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

/** Access the authentication context from any child component. */
export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}
