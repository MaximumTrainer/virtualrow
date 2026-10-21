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
