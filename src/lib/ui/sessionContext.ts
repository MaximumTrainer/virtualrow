/**
 * The session store over Svelte context (#542 P1, Row screen).
 *
 * The shell (`+layout.svelte`) creates one {@link SessionStore} and provides
 * it; the Row and workout routes read it with {@link getSessionStore}. Mirrors
 * `routesContext` — a Symbol key, and `getSessionStore` throws when no provider
 * is mounted rather than inventing a second session.
 */
import { getContext, setContext } from 'svelte';
import { SessionStore } from './sessionStore.svelte';

const SESSION_KEY = Symbol('virtualrow.session');

/** Provide a SessionStore to the subtree. Returns it for the caller to use. */
export function setSessionStore(store: SessionStore = new SessionStore()): SessionStore {
  setContext(SESSION_KEY, store);
  return store;
}

/** Read the provided SessionStore. Throws if the shell did not provide one. */
export function getSessionStore(): SessionStore {
  const store = getContext<SessionStore | undefined>(SESSION_KEY);
  if (!store) {
    throw new Error('getSessionStore() called with no SessionStore in context');
  }
  return store;
}
