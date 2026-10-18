/**
 * Phase-1 kill switch for the #505 Routes-screen overhaul: the map-primary
 * overview with pins, drawer, and modal detail. Default `undefined` (reads
 * as off) so Phase 1 ships with the existing route-search markup untouched;
 * Phase 2 of the issue flips the sense and removes the old branch.
 *
 * Mirrors the opt-in shape of `__VIRTUALROW_CSM` (#495) and
 * `__VIRTUALROW_SHADER_GRASS` (#496): a value that is not strictly `true`
 * reads as off, so a stray console value cannot turn it on.
 */
export function isRouteOverviewV2Enabled(): boolean {
  if (typeof window === 'undefined') return false;
  return window.__VIRTUALROW_ROUTE_MAP_V2 === true;
}
