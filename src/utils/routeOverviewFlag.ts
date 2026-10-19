/**
 * #505 Phase 3: the map-primary Routes-screen overhaul is now the default. The
 * flag stays as an opt-out hatch so debugging can still revert to the pre-#505
 * layout with `window.__VIRTUALROW_ROUTE_MAP_V2 = false`.
 *
 * Mirrors `__VIRTUALROW_CSM` (#495 Phase 2): any value that is not strictly
 * `false` reads as on, so a stray non-boolean cannot accidentally turn the
 * feature off.
 */
export function isRouteOverviewV2Enabled(): boolean {
  if (typeof window === 'undefined') return true;
  return window.__VIRTUALROW_ROUTE_MAP_V2 !== false;
}
