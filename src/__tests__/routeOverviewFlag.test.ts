import { describe, it, expect, afterEach } from 'vitest';
import { isRouteOverviewV2Enabled } from '../utils/routeOverviewFlag';

describe('isRouteOverviewV2Enabled', () => {
  afterEach(() => {
    delete window.__VIRTUALROW_ROUTE_MAP_V2;
  });

  it('is false when the flag is undefined (Phase 1 default)', () => {
    expect(isRouteOverviewV2Enabled()).toBe(false);
  });

  it('is false when the flag is explicitly false', () => {
    window.__VIRTUALROW_ROUTE_MAP_V2 = false;
    expect(isRouteOverviewV2Enabled()).toBe(false);
  });

  it('is true only when the flag is strictly true (opt-in)', () => {
    // Mirrors the __VIRTUALROW_CSM / __VIRTUALROW_SHADER_GRASS pattern: any
    // non-true value is off, so a stray string from the dev console cannot
    // flip the flag.
    (window as unknown as { __VIRTUALROW_ROUTE_MAP_V2?: unknown }).__VIRTUALROW_ROUTE_MAP_V2 = 'true';
    expect(isRouteOverviewV2Enabled()).toBe(false);

    window.__VIRTUALROW_ROUTE_MAP_V2 = true;
    expect(isRouteOverviewV2Enabled()).toBe(true);
  });
});
