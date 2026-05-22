// Shared constants and types for the Rower3D component and its sub-modules.

declare global {
  interface Window {
    __PLAYWRIGHT_TESTING?: boolean;
  }
}

/** True when running under Playwright automation. Set before the SPA boots and never toggled. */
export const IS_TEST_MODE = typeof window !== 'undefined' && !!window.__PLAYWRIGHT_TESTING;

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
