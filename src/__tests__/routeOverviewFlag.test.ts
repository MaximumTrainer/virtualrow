import { describe, it, expect, afterEach } from 'vitest';
import { isRouteOverviewV2Enabled } from '../utils/routeOverviewFlag';

describe('isRouteOverviewV2Enabled', () => {
  afterEach(() => {
    delete window.__VIRTUALROW_ROUTE_MAP_V2;
  });

  it('is true when the flag is undefined (Phase 3 default)', () => {
    expect(isRouteOverviewV2Enabled()).toBe(true);
  });

  it('is true when the flag is explicitly true', () => {
    window.__VIRTUALROW_ROUTE_MAP_V2 = true;
    expect(isRouteOverviewV2Enabled()).toBe(true);
  });

  it('is off only when the flag is strictly false (opt-out)', () => {
    // Mirrors the __VIRTUALROW_CSM pattern: any value that is not strictly
    // false reads as on, so a stray console value cannot turn the feature off.
    (window as unknown as { __VIRTUALROW_ROUTE_MAP_V2?: unknown }).__VIRTUALROW_ROUTE_MAP_V2 =
      'false';
    expect(isRouteOverviewV2Enabled()).toBe(true);

    window.__VIRTUALROW_ROUTE_MAP_V2 = false;
    expect(isRouteOverviewV2Enabled()).toBe(false);
  });
});
