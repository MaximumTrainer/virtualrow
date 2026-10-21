/**
 * The route catalogue store over Svelte context (#542 P1, Routes screen).
 *
 * The shell (`+layout.svelte`) creates one {@link RoutesStore} and provides it;
 * the Routes and Row routes read it with {@link getRoutesStore}. Mirrors
 * `authContext` — a Symbol key, and `getRoutesStore` throws when no provider is
 * mounted rather than inventing a second catalogue.
 */
import { getContext, setContext } from 'svelte';
import { RoutesStore } from './routesStore.svelte';

const ROUTES_KEY = Symbol('virtualrow.routes');

/** Provide a RoutesStore to the subtree. Returns it for the caller to use. */
export function setRoutesStore(store: RoutesStore = new RoutesStore()): RoutesStore {
  setContext(ROUTES_KEY, store);
  return store;
}

/** Read the provided RoutesStore. Throws if the shell did not provide one. */
export function getRoutesStore(): RoutesStore {
  const store = getContext<RoutesStore | undefined>(ROUTES_KEY);
  if (!store) {
    throw new Error('getRoutesStore() called with no RoutesStore in context');
  }
  return store;
}
