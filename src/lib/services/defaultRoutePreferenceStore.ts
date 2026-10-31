/**
 * Per-athlete default-route preference (issue #219, R6).
 *
 * A signed-in athlete can mark one route as their default; it is pre-selected
 * on every subsequent load. Storage is `localStorage` keyed by intervals.icu
 * athlete ID, mirroring `localStorageWorkoutStore` — a shared browser must not
 * leak one athlete's default to the next (AC6.9).
 *
 * Storage key format: `virtualrow:defaultRoute:{athleteId}`
 *
 * Like the workout store this is best-effort: a private window, a browser with
 * site data blocked, or a full quota all throw, and the app must carry on
 * without a default rather than fail to render (AC6.8).
 *
 * This is the deliberate interim until the Postgres persistence layer lands
 * (issue #37), at which point the preference moves server-side.
 */

export const DEFAULT_ROUTE_KEY_PREFIX = 'virtualrow:defaultRoute:';

function storageKey(userId: string): string {
  return `${DEFAULT_ROUTE_KEY_PREFIX}${userId}`;
}

/** Read the athlete's stored default route id, or null if they have none. */
function getDefaultRouteId(userId: string): string | null {
  if (!userId) return null;
  try {
    return localStorage.getItem(storageKey(userId));
  } catch (err) {
    console.warn('[DefaultRoutePreferenceStore] Failed to read default route:', err);
    return null;
  }
}

/**
 * Set the athlete's default route. Only one default is held per athlete, so
 * this replaces any previous value (AC6.5).
 */
function setDefaultRouteId(userId: string, routeId: string): void {
  if (!userId || !routeId) return;
  try {
    localStorage.setItem(storageKey(userId), routeId);
  } catch (err) {
    console.warn('[DefaultRoutePreferenceStore] Failed to save default route:', err);
  }
}

/** Forget the athlete's default route. */
function clearDefaultRouteId(userId: string): void {
  if (!userId) return;
  try {
    localStorage.removeItem(storageKey(userId));
  } catch (err) {
    console.warn('[DefaultRoutePreferenceStore] Failed to clear default route:', err);
  }
}

/**
 * Resolve the stored default against the routes actually available.
 *
 * A stored id can outlive its route — an imported course the athlete later
 * deleted, or a catalogue that changed under them. Rather than selecting
 * nothing, the stale key is dropped so the caller falls back to the bundled
 * demo route (AC6.4).
 *
 * @param userId       the athlete, or null for a signed-out visitor
 * @param availableIds ids of the routes currently in the catalogue
 */
function resolveDefaultRouteId(
  userId: string | null,
  availableIds: readonly string[],
): string | null {
  if (!userId) return null;

  const stored = getDefaultRouteId(userId);
  if (!stored) return null;

  if (!availableIds.includes(stored)) {
    clearDefaultRouteId(userId);
    return null;
  }
  return stored;
}

export class DefaultRoutePreferenceStore {
  getDefaultRouteId = getDefaultRouteId;
  setDefaultRouteId = setDefaultRouteId;
  clearDefaultRouteId = clearDefaultRouteId;
  resolveDefaultRouteId = resolveDefaultRouteId;
}

export const defaultRoutePreferenceStore = new DefaultRoutePreferenceStore();
