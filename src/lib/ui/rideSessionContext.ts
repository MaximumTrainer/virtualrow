/**
 * Svelte context for the {@link RideSessionStore} (#542 workout slice).
 *
 * Provided once in the shell (`+layout.svelte`) so the live rower pipeline
 * outlives the Routes → workout navigation, and read by the workout route.
 * Mirrors the auth / services / routes / session contexts.
 */
import { getContext, setContext } from 'svelte';
import type { RideSessionStore } from './rideSession.svelte';

const KEY = Symbol('virtualrow:ride-session');

export function setRideSession(store: RideSessionStore): RideSessionStore {
  setContext(KEY, store);
  return store;
}

export function getRideSession(): RideSessionStore {
  const store = getContext<RideSessionStore | undefined>(KEY);
  if (!store) {
    throw new Error('getRideSession() called with no RideSessionStore in context');
  }
  return store;
}
