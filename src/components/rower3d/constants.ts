// Shared constants and types for the Rower3D component and its sub-modules.

declare global {
  interface Window {
    __PLAYWRIGHT_TESTING?: boolean;
    /**
     * Forces a performance mode, independent of {@link IS_TEST_MODE}.
     *
     * Without this the test flag decided both "are we in a test" and "which
     * effects run", so the postprocessing path could never execute under
     * automation — it was exempt from testing by construction (issue #197).
     * Setting this lets a spec run the full effect stack while still being in
     * test mode.
     */
    __VIRTUALROW_PERFORMANCE_MODE?: 'low' | 'auto' | 'high';
  }
}

/** True when running under Playwright automation. Set before the SPA boots and never toggled. */
export const IS_TEST_MODE = typeof window !== 'undefined' && !!window.__PLAYWRIGHT_TESTING;

/**
 * Performance mode to render at.
 *
 * An explicit override wins; otherwise automation defaults to `low` for speed
 * and determinism, and real users get `auto`.
 */
export function resolvePerformanceMode(): 'low' | 'auto' | 'high' {
  if (typeof window === 'undefined') return 'auto';
  const override = window.__VIRTUALROW_PERFORMANCE_MODE;
  if (override === 'low' || override === 'auto' || override === 'high') return override;
  return window.__PLAYWRIGHT_TESTING ? 'low' : 'auto';
}

/**
 * Metres-to-scene-units factor for every route curve in the scene.
 *
 * One source of truth: the geometry builders divide by it to recover a route's
 * real length when choosing their sampling resolution, so a curve built at a
 * different scale would be sampled at the wrong one.
 */
export const SCENE_SCALE = 0.1;

/**
 * True when the mode was pinned by a test or a user, and hardware detection
 * must keep its hands off.
 */
export function hasExplicitPerformanceMode(): boolean {
  if (typeof window === 'undefined') return true;
  const override = window.__VIRTUALROW_PERFORMANCE_MODE;
  return override === 'low' || override === 'auto' || override === 'high' || IS_TEST_MODE;
}

// Water channel width constant - keeps water wider than single scull (~1.5m wide)
export const WATER_CHANNEL_WIDTH = 20; // meters in scene units (boat is ~0.5 wide, water is 40x wider)
export const RIVERBANK_WIDTH = 60; // width of each riverbank
export const LANDSCAPE_OFFSET = 50; // minimum distance from water center to landscape objects

export const RENDER_CONFIG = {
  /** Progress-band around boat for landscape shadow casting (0..1) */
  shadowNearProgressBand: 0.08,
  /** World-unit band around boat for non-curve landscape shadow casting */
  shadowNearBand: 150,
} as const;

// GPU backend type for renderer selection
export type GPUBackend = 'webgpu' | 'webgl' | 'none';
export type PerformanceMode = 'auto' | 'high' | 'low';
