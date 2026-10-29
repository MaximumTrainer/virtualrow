/**
 * Public entry point for the WebGPU engine (#550 FR1). The UI shell owns the
 * `<canvas>` and calls this in `onMount`, matching the structural signature
 * agreed with the UI thread.
 *
 * The exported `RideAttach` / `RideRenderer` types mirror the UI thread's
 * `src/lib/ui/rideCanvas.ts` shape (which lives on their branch); when their
 * branch merges this file keeps satisfying it structurally without a hard
 * import. Returning `null` means "renderer unavailable" and the host shows
 * its placeholder.
 *
 * Device-lost recovery (#584 FR1, D1-a): the per-device scene lives in
 * `rideScene.ts`. `attach` owns the device-session lifecycle, the outer
 * render loop, and the one-attempt reattach on the same canvas when the
 * current device fires its `lost` promise. On a second loss (the retry
 * device also dies) the engine stops drawing and publishes the
 * `renderer-unavailable` fallback.
 */

/// <reference types="@webgpu/types" />

import { requestDevice, type DeviceSession } from './device';
import { publishFallback, type WebGPUFallbackReason } from './health';
import type { RideFrame } from './rideFrame';
import {
  createRideScene,
  isSceneryRoute,
  type RideSceneHandle,
  type SceneryRoute,
} from './rideScene';
import {
  createTelemetry,
  publishBanner,
  releaseTelemetry,
  type TelemetryHandles,
} from './telemetry';

export interface RideRenderer {
  dispose(): void;
}

export { isSceneryRoute, type SceneryRoute };

/**
 * #584 FR1 D2-a — banner copy ported verbatim from the retired WebGL
 * `webgl-context-recovery.spec.ts`'s messages so the ride-view banner has
 * one authoritative source. The spec that used to assert against this text
 * is now its contract on the engine side (`ac4PortedBehaviors.test.ts`).
 */
export const BANNER_LOST_RESTORING =
  'Lost the graphics context — restoring…';
export const BANNER_LOST_FAILED =
  "We couldn't get the graphics context back. Your row is still being recorded.";

export type RideAttachOpts = {
  tier?: string;
  /**
   * #591-fu P2c: separate "view distance" tier (LOD / fog / sprout
   * window / stream look-ahead), independent of the quality tier above.
   * Omitted falls back to `tier`.
   */
  distanceTier?: string;
  route?: unknown;
  testMode?: boolean;
  /**
   * Per-frame data from the UI shell (#570 FR7). Optional — the smoke
   * pages pass no frame and the engine falls back to a canned chase
   * camera. The engine never caches a `RideFrame`; it calls `getFrame`
   * once per rendered frame and reads the returned object.
   */
  getFrame?: () => RideFrame;
  /**
   * Which crewed scull GLB to load. The shell resolves this against the
   * athlete's intervals.icu profile `sex` and the stored CrewPreference
   * (#232 / #443), so the engine stays free of that policy. Defaults to
   * `male` — the GLB the engine shipped with before the seam reached it.
   */
  crew?: 'male' | 'female';
};

export type RideAttach = (
  canvas: HTMLCanvasElement,
  opts?: RideAttachOpts,
) => RideRenderer | null | Promise<RideRenderer | null>;

const PLAYWRIGHT_TESTING_KEY = '__PLAYWRIGHT_TESTING' as const;
const FORCE_LOST_KEY = '__ROWER3D_FORCE_DEVICE_LOST' as const;

export const attach: RideAttach = async (canvas, opts = {}) => {
  const telemetry = createTelemetry(() => void frameOnce());
  canvas.setAttribute('data-backend', 'webgpu');

  const nav = (globalThis as unknown as { navigator?: { gpu?: GPU } }).navigator;

  // Scene state. On a device loss we dispose the current scene and try to
  // build a fresh one on the same canvas (D1-a). Everything in `scene`
  // lives on one GPUDevice; `attach` outlasts them.
  let scene: RideSceneHandle | null = null;
  let outerDisposed = false;
  let rafId: number | null = null;
  // Guards against overlapping reattach attempts: a flap of two `lost`
  // events in quick succession must still only trigger one retry.
  let reattachInFlight = false;

  const frameOnce = (): void => {
    scene?.frameOnce();
  };

  const startLoop = (): void => {
    if (opts.testMode) return;
    const loop = (): void => {
      if (outerDisposed) return;
      frameOnce();
      const raf = (globalThis as unknown as { requestAnimationFrame?: (cb: () => void) => number })
        .requestAnimationFrame;
      if (raf) {
        rafId = raf(loop);
      }
    };
    loop();
  };

  const cancelLoop = (): void => {
    if (rafId === null) return;
    const cancel = (globalThis as unknown as { cancelAnimationFrame?: (id: number) => void })
      .cancelAnimationFrame;
    cancel?.(rafId);
    rafId = null;
  };

  // #584 FR2 — expose a page-side helper so a Playwright spec can force a
  // device loss (there is no `WEBGL_lose_context` equivalent for WebGPU and
  // `GPUDevice.destroy()` must be called from inside the page). Gated on
  // `__PLAYWRIGHT_TESTING` (D4-a) so a shipped page can't call it.
  const installForceLostSeam = (device: GPUDevice): void => {
    const win = (globalThis as unknown as {
      window?: Record<string, unknown>;
    }).window;
    if (!win) return;
    if (!win[PLAYWRIGHT_TESTING_KEY]) return;
    win[FORCE_LOST_KEY] = () => {
      try {
        device.destroy();
      } catch {
        // destroy() can throw on an already-destroyed device; ignore.
      }
    };
  };
  const removeForceLostSeam = (): void => {
    const win = (globalThis as unknown as {
      window?: Record<string, unknown>;
    }).window;
    if (!win) return;
    delete win[FORCE_LOST_KEY];
  };

  // Device-loss handler. Called by `requestDevice`'s wiring when the
  // current device's `lost` promise resolves.
  //
  // D1-a (same canvas, rebuild internals) + D3-a (drop to
  // `renderer-unavailable` on the first failed retry). The first loss
  // disposes the current scene, publishes the "restoring" banner, flips
  // `__ROWER3D_CONTEXT_STATE.kind` to `'lost'`, and spins up a retry. A
  // second loss (either during retry setup or on the retry's own device)
  // publishes `renderer-unavailable` and stops drawing.
  const onDeviceLost = (reason: WebGPUFallbackReason | null): void => {
    if (outerDisposed) return;
    const current = scene;
    scene = null;
    if (reason === 'renderer-unavailable') {
      telemetry.contextState.kind = 'unavailable';
      telemetry.contextState.reason = 'renderer-unavailable';
      telemetry.contextState.backend = 'none';
      publishBanner(telemetry, BANNER_LOST_FAILED, 'failed');
      current?.dispose();
      cancelLoop();
      removeForceLostSeam();
      return;
    }
    // First loss. Mark lost, publish, and kick off a retry.
    telemetry.contextState.kind = 'lost';
    telemetry.contextState.reason = 'device-lost';
    publishFallback('device-lost');
    publishBanner(telemetry, BANNER_LOST_RESTORING, 'restoring');
    // Stop the outer loop so frameOnce doesn't try to run against a null
    // scene (frameOnce handles null anyway, but keeping the loop alive on
    // a dead device burns rAF ticks for no reason).
    cancelLoop();
    current?.dispose();
    removeForceLostSeam();
    void (async () => {
      if (reattachInFlight) return;
      reattachInFlight = true;
      try {
        const next = await buildScene(/* isRetry */ true);
        if (outerDisposed) {
          next?.dispose();
          return;
        }
        if (next) {
          scene = next;
          telemetry.contextState.kind = 'ready';
          telemetry.contextState.reason = undefined;
          telemetry.contextState.backend = 'webgpu';
          publishBanner(telemetry, '', '');
          installForceLostSeam(next.device);
          startLoop();
        }
        // On a null `next` the inner `requestDevice({ isRetry: true })`
        // has already run `onDeviceLost('renderer-unavailable')`, which
        // took the `'renderer-unavailable'` branch above — the banner
        // and context state are set there.
      } finally {
        reattachInFlight = false;
      }
    })();
  };

  const buildScene = async (isRetry: boolean): Promise<RideSceneHandle | null> => {
    const session: DeviceSession = await requestDevice(nav, {
      isRetry,
      onDeviceLost,
    });
    if (session.state.kind !== 'ready') {
      const reason =
        session.state.kind === 'unavailable' ? session.state.reason : 'renderer-unavailable';
      publishFallback(reason);
      telemetry.contextState.kind = 'unavailable';
      telemetry.contextState.reason = reason;
      telemetry.contextState.backend = 'none';
      if (isRetry) {
        publishBanner(telemetry, BANNER_LOST_FAILED, 'failed');
      }
      return null;
    }
    const handle = await createRideScene(canvas, session.state.device, telemetry, opts, session);
    return handle;
  };

  const initial = await buildScene(/* isRetry */ false);
  if (!initial) {
    releaseTelemetry();
    canvas.removeAttribute('data-backend');
    return null;
  }
  scene = initial;
  telemetry.contextState.kind = 'ready';
  telemetry.contextState.backend = 'webgpu';
  installForceLostSeam(initial.device);

  if (opts.testMode) {
    // In test mode we draw one frame and leave scheduling to the caller
    // via `__ROWER3D_FORCE_RENDER()`.
    frameOnce();
  } else {
    startLoop();
  }

  const renderer: RideRenderer & {
    _frameOnce: () => void;
    _telemetry: TelemetryHandles;
    /** Test-only — the current scene's `GPUDevice`, used by the device-lost
     *  specs to call the mock's `__triggerLost`. Live, not snapshotted:
     *  reads the current scene each time so a post-reattach test sees
     *  the retry device, not the dead one. */
    readonly _liveDevice: GPUDevice | undefined;
  } = {
    _frameOnce: frameOnce,
    _telemetry: telemetry,
    get _liveDevice() {
      return scene?.device;
    },
    dispose() {
      if (outerDisposed) return;
      outerDisposed = true;
      cancelLoop();
      scene?.dispose();
      scene = null;
      removeForceLostSeam();
      releaseTelemetry();
      canvas.removeAttribute('data-backend');
    },
  };
  return renderer;
};

export default attach;
