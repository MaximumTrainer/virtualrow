/**
 * Svelte auth context (#542 P1, F3). The root layout creates one
 * {@link AuthStore}, provides it with {@link setAuth}, and descendants read it
 * with {@link getAuth}. Both must be called during component initialisation,
 * like all Svelte context access.
 */
import { getContext, setContext } from 'svelte';
import { AuthStore } from './auth.svelte';

const AUTH_KEY = Symbol('virtualrow.auth');

/** Provide an {@link AuthStore} to this subtree. Returns it for convenience. */
export function setAuth(store: AuthStore): AuthStore {
  setContext(AUTH_KEY, store);
  return store;
}

/**
 * Resolve the {@link AuthStore} from the nearest {@link setAuth}. Throws if no
 * provider is mounted — unlike services, there is no safe default auth state
 * to fall back to, and a missing provider is a wiring bug, not a valid mode.
 */
export function getAuth(): AuthStore {
  const store = getContext<AuthStore | undefined>(AUTH_KEY);
  if (!store) {
    throw new Error('getAuth() called with no AuthStore provided — call setAuth() in a parent.');
  }
  return store;
}
