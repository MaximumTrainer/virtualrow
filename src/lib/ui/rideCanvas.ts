/**
 * The ride-canvas seam (#542 P1 / D10-c).
 *
 * This is the boundary where the UI-shell track and the engine track meet,
 * agreed with the engine track (#550). The shell owns the host component
 * (`Canvas3DHost.svelte`), which renders `.rower3d-canvas-container` and the
 * `<canvas>` inside it, and it owns this contract. The engine track implements
 * {@link RideAttach} in `src/lib/renderer/` and attaches to the canvas it is
 * handed; it imports these types from here and the shell never reaches into
 * `src/lib/renderer/`. The one seam import runs the other way: the ride view
 * imports the engine's single public `attach` entrypoint and passes it to the
 * host as the `attach` prop. Until the engine lands, the host runs a bare
 * canvas (no renderer, no three) and the non-3D specs drive the UI as before.
 *
 * Keep this framework-free: the engine imports the types without pulling in
 * any Svelte.
 */

/**
 * The live row state the engine pulls once per frame to place the boat and the
 * ghost (#542 workout slice). The shell computes it from the rower pipeline
 * (see `rideSession.svelte.ts`); the engine reads it each `requestAnimationFrame`
 * and publishes the `__ROWER3D_POS` / `__ROWER3D_GHOST_METERS` globals the
 * workout specs read. Framework-free so the engine imports it without Svelte.
 */
/**
 * The four camera views the rig cycles through on V (#328). Mirrors
 * `src/lib/renderer/engine/camera.ts`'s `CameraView` without a hard import so
 * the seam stays framework-free.
 */
export type RideCameraView = 'chase' | 'side' | 'bow' | 'high';

export interface RideFrame {
  /** Current split, seconds per 500 m, or null before the first stroke. */
  readonly paceSPer500: number | null;
  /** Metres rowed so far, or null before the first packet. */
  readonly distanceMeters: number | null;
  readonly cadence: number | null;
  /** The session is active and not paused — the boat and crew are moving. */
  readonly isPlaying: boolean;
  /** Hold the boat at progress 0 (the start countdown, #336). */
  readonly holdBoat: boolean;
  /** The boat has crossed the line — the blade foam bursts (#336). */
  readonly finished: boolean;
  /** The structured workout's speed factor, 1 for a free row. */
  readonly intensityFactor: number;
  /** The row's clock in seconds, used to place the ghost. */
  readonly elapsedSeconds: number;
  /**
   * What this row is rowed against (#338), or null when rowing alone. A plain
   * discriminated union (pace / recorded) from `components/rower3d/ghost`.
   */
  readonly ghost: unknown;
  /**
   * Which camera view the rig uses this frame (#328, restored post-React
   * cutover). Optional: the engine defaults to chase.
   */
  readonly view?: RideCameraView;
}

/** Options the shell passes the engine when it starts a ride. */
export interface RideRendererOptions {
  /** Resolved performance tier (basic | low | medium | high | extra-high). */
  readonly tier?: string;
  /**
   * The selected route the ride draws. Typed loosely at the seam so the shell
   * and engine don't couple on a route shape mid-port; both read it through the
   * shared `src/lib/types` definitions. Finalised when the ride view lands.
   */
  readonly route?: unknown;
  /** True under Playwright, so the engine honours the `__ROWER3D_*` contract. */
  readonly testMode?: boolean;
  /**
   * Pulled by the engine once per frame for the live row state (#542 workout
   * slice). Optional and backward-compatible: an engine that ignores it draws a
   * static scene, which is what P2's sky/bank/water skeleton does today.
   */
  readonly getFrame?: () => RideFrame;
  /**
   * Which crewed scull GLB to render (#232 / #443 appearance seam). Already
   * resolved by the shell against the signed-in profile's `sex` field and the
   * stored CrewPreference, so the engine stays free of that policy. Defaults
   * to `male` when omitted — the GLB the engine shipped with before the seam.
   */
  readonly crew?: 'male' | 'female';
}

/** A running renderer. The host calls {@link dispose} when the ride unmounts. */
export interface RideRenderer {
  /** Release GPU resources and listeners. Must be idempotent. */
  dispose(): void;
}

/**
 * The engine track implements and exports this as its single public entrypoint
 * (`src/lib/renderer`): given the host's canvas, start rendering and return a
 * handle. It may be async (device/adapter request). Returning `null` means the
 * engine declined (e.g. no WebGPU) and the host shows its unavailable
 * placeholder — the full "needs WebGPU" screen is P9 (AC11).
 */
export type RideAttach = (
  canvas: HTMLCanvasElement,
  options?: RideRendererOptions,
) => RideRenderer | null | Promise<RideRenderer | null>;
