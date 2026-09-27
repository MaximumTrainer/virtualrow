// Shared constants and types for the Rower3D component and its sub-modules.

declare global {
  interface Window {
    __PLAYWRIGHT_TESTING?: boolean;
    /**
     * Ask automation to render the shipping scene: PMREM environment, water
     * mirror, wake, spray, contact shadow and the GLB scull. See
     * `RENDER_SHIPPING_EXTRAS`.
     */
    __VIRTUALROW_SHIPPING_SCENE?: boolean;
  }
}

/** True when running under Playwright automation. Set before the SPA boots and never toggled. */
export const IS_TEST_MODE = typeof window !== 'undefined' && !!window.__PLAYWRIGHT_TESTING;

/**
 * Whether to publish render and frame telemetry onto `window`.
 *
 * Test mode publishes it, and test mode also drops the effect stack, the wake,
 * the spray and the environment probe. So everything the numbers described was
 * the automation scene rather than the one a rower gets: the draw-call budget
 * beside them had to be written as "186 here, 1114 outside test mode", which
 * is a budget for a scene nobody runs (#342).
 *
 * `__VIRTUALROW_TELEMETRY` separates the two, exactly as
 * `__VIRTUALROW_PERFORMANCE_MODE` separated the tier from the automation flag
 * in #197. A spec can then measure the scene it means to budget.
 */
export const isTelemetryPublished = (): boolean =>
  typeof window !== 'undefined' &&
  (!!window.__PLAYWRIGHT_TESTING || !!window.__VIRTUALROW_TELEMETRY);

/**
 * True when the scene should draw every costly extra a rower gets: the sky
 * environment map, the water mirror and env map, the wake, the spray and blade
 * foam, the contact shadow, the sun disc and the GLB scull. Outside test mode
 * this is always true; under automation it is only true when the spec asked.
 *
 * Same shape as `__VIRTUALROW_TELEMETRY` (which split telemetry from
 * automation, #342) and `__VIRTUALROW_PERFORMANCE_MODE` (which split the tier
 * from automation, #197): the flag lets one automation concept — "measure the
 * shipping scene" — be turned on without pulling the others with it.
 *
 * The gates that read this are cost gates (measured in #416, #342, #352):
 *
 * - the PMREM environment blocks the software rasteriser's main thread for
 *   about four seconds and used to flake three specs on a loaded runner;
 * - `WaterReflectionPlane` and `MeshReflectorMaterial` each render the scene
 *   into a reflection target;
 * - `ContactShadow` (this repo's textured quad, not drei's) put an extra 171
 *   draw calls on `low` and 348 on `high`;
 * - the wake, drive spray, blade foam and finish splash each take a particle
 *   system through the frame;
 * - the GLB scull loads asynchronously and dresses on top of the procedural
 *   fallback the test-mode boat renders directly.
 *
 * Determinism gates (the `midday` conditions default, the telemetry publishes,
 * the shader-error counter) stay keyed to `IS_TEST_MODE` — they are not what
 * "the shipping scene" refers to.
 *
 * Read once at module load: `IS_TEST_MODE` is set the same way, and rewriting
 * the flag mid-session would leave half the scene on the old value.
 */
export const RENDER_SHIPPING_EXTRAS: boolean =
  !IS_TEST_MODE ||
  (typeof window !== 'undefined' && !!window.__VIRTUALROW_SHIPPING_SCENE);

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
 * The name on the group that carries the boat along the route.
 *
 * One group in the graph whatever the quality tier or the asset ladder, so a
 * test can find the boat by name rather than by counting groups (#343).
 */
export const BOAT_GROUP_NAME = 'BoatGroup';

/**
 * Metres-to-scene-units factor for every route curve in the scene.
 *
 * One source of truth, and now genuinely one: it lives in `utils/worldScale`
 * because `routeEnrichmentService` needs it and a service may not import from
 * `components/`, so it used to keep a second copy of the number (#321).
 */
export { SCENE_SCALE } from '../../utils/worldScale';

/**
 * True when the mode was pinned by a test or a user, and hardware detection
 * must keep its hands off.
 */
export function hasExplicitPerformanceMode(): boolean {
  if (typeof window === 'undefined') return true;
  const override = window.__VIRTUALROW_PERFORMANCE_MODE;
  return override === 'low' || override === 'auto' || override === 'high' || IS_TEST_MODE;
}

// The waterway, in metres.
//
// These read as metres now and drew ten times as much before (#321): the
// channel said 20 and laid out 200 m of water, the landscape stood 500 m back
// rather than 50. The numbers are unchanged - what was wrong was the unit.
/** Metres of water across the channel, before a route's own width widens it. */
export const WATER_CHANNEL_WIDTH = 20;
/** Metres of bank either side of the water. */
export const RIVERBANK_WIDTH = 60;
/**
 * Least metres from the centre of the water to the first landscape object.
 * Wider water pushes it out to the bank plus the scenery margin (#379).
 */
export const LANDSCAPE_OFFSET = 50;

export const RENDER_CONFIG = {
  /** Progress-band around boat for landscape shadow casting (0..1) */
  shadowNearProgressBand: 0.08,
  /** Metres around the boat within which non-curve landscape casts shadows. */
  shadowNearBand: 1500,
} as const;

// GPU backend type for renderer selection
/**
 * What the scene is drawing with.
 *
 * `webgpu` was a third option that nothing ever selected: R3F builds a
 * `WebGLRenderer` whatever the probe said, so the label only ever misled the
 * telemetry log that #232 and #309 read (#345).
 */
export type GPUBackend = 'webgl' | 'none';
export type PerformanceMode = 'auto' | 'high' | 'low';
