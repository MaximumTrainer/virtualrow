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
 */

/// <reference types="@webgpu/types" />

import { mat4, mat4Identity, mat4LookAt, mat4Multiply, mat4Perspective } from '../math/mat4';
import { vec3 } from '../math/vec3';
import { createBankPass } from '../passes/bank';
import { createSkyPass } from '../passes/sky';
import { createWaterPass } from '../passes/water';
import { createInstancePool, type InstancePool, type PoolInput } from '../plan/instancePools';
import { createSceneryPass } from './sceneryPass';
import { requestDevice, type DeviceSession } from './device';
import { createFrameGraph, type FrameGraph, type FrameUniforms, type Pass } from './frameGraph';
import { publishFallback } from './health';
import { createTelemetry, releaseTelemetry, type TelemetryHandles } from './telemetry';
import { createFrameUniformBuffer, packFrameUniforms } from './uniforms';

export interface RideRenderer {
  dispose(): void;
}

/**
 * A scenery route shape the engine understands: the UI-side `route` is
 * `unknown` at the seam (per the agreement with the UI thread). When a route
 * is a `SceneryRoute`, the engine builds pools from `pools`; anything else
 * mounts an empty scenery pass.
 */
export interface SceneryRoute {
  pools: PoolInput[];
}

export const isSceneryRoute = (route: unknown): route is SceneryRoute =>
  !!route && typeof route === 'object' && Array.isArray((route as SceneryRoute).pools);

export type RideAttachOpts = {
  tier?: string;
  route?: unknown;
  testMode?: boolean;
};

export type RideAttach = (
  canvas: HTMLCanvasElement,
  opts?: RideAttachOpts,
) => RideRenderer | null | Promise<RideRenderer | null>;

/** Internal clock used by the test harness. */
const now = (): number =>
  typeof performance !== 'undefined' ? performance.now() : Date.now();

export const attach: RideAttach = async (canvas, opts = {}) => {
  const telemetry = createTelemetry(() => void frameOnce());
  canvas.setAttribute('data-backend', 'webgpu');

  const nav = (globalThis as unknown as { navigator?: { gpu?: GPU } }).navigator;
  const session: DeviceSession = await requestDevice(nav, {
    onDeviceLost(reason) {
      if (reason === 'renderer-unavailable') {
        telemetry.contextState.kind = 'unavailable';
        telemetry.contextState.reason = reason;
        telemetry.contextState.backend = 'none';
      }
    },
  });

  if (session.state.kind !== 'ready') {
    publishFallback(session.state.kind === 'unavailable' ? session.state.reason : 'renderer-unavailable');
    telemetry.contextState.kind = 'unavailable';
    telemetry.contextState.reason =
      session.state.kind === 'unavailable' ? session.state.reason : 'renderer-unavailable';
    telemetry.contextState.backend = 'none';
    return null;
  }

  const { device } = session.state;
  const context = canvas.getContext('webgpu') as GPUCanvasContext | null;
  if (!context) {
    telemetry.contextState.kind = 'unavailable';
    telemetry.contextState.reason = 'webgpu-unsupported';
    telemetry.contextState.backend = 'none';
    session.dispose();
    return null;
  }

  const format: GPUTextureFormat =
    (navigator as unknown as { gpu?: GPU }).gpu?.getPreferredCanvasFormat?.() ?? 'bgra8unorm';
  context.configure({ device, format, alphaMode: 'opaque' });

  let width = Math.max(1, Math.floor(canvas.clientWidth || canvas.width || 320));
  let height = Math.max(1, Math.floor(canvas.clientHeight || canvas.height || 240));
  canvas.width = width;
  canvas.height = height;

  let depthTexture = device.createTexture({
    label: 'depth',
    size: { width, height },
    format: 'depth24plus',
    usage: GPUTextureUsage.RENDER_ATTACHMENT,
  });

  const frameUniforms = createFrameUniformBuffer(device);
  const uniformScratch = new Float32Array(64);

  // D7-a of #555: wire the scenery pass unconditionally. When no scenery
  // route is provided the pass is empty and encodes zero work.
  const scenePools: InstancePool[] = isSceneryRoute(opts.route)
    ? opts.route.pools.map((input) => createInstancePool(device, input))
    : [];
  const sceneryPass = createSceneryPass({
    device,
    format,
    frameUniforms,
    pools: scenePools,
    telemetry: telemetry.scenery,
  });
  for (const pool of scenePools) {
    telemetry.scenery.pools.push({
      kind: pool.kind,
      speciesIndex: pool.speciesIndex,
      chunkIndex: pool.chunkIndex,
      instanceCount: pool.instanceCount,
      drawn: -1,
    });
  }
  // Pass order: sky → bank → scenery → water. The scenery pass goes between
  // the bank's ground and the translucent water strip so trees sit behind
  // the water surface edges cleanly.
  const passes: Pass[] = [
    createSkyPass({ device, format, frameUniforms }),
    createBankPass({ device, format, frameUniforms }),
    sceneryPass,
    createWaterPass({ device, format, frameUniforms }),
  ];
  const graph: FrameGraph = createFrameGraph(passes);

  const frame: FrameUniforms = {
    view: mat4Identity(mat4()),
    proj: mat4(),
    viewProj: mat4(),
    camPos: vec3(0, 2.6, 7),
    sunDir: vec3(0.3, 0.8, 0.5),
    fog: new Float32Array([0.001, 0.0005, 0, 0]),
    time: 0,
  };

  const start = now();
  let rafId: number | null = null;
  let disposed = false;

  const resize = (): void => {
    const w = Math.max(1, Math.floor(canvas.clientWidth || canvas.width || width));
    const h = Math.max(1, Math.floor(canvas.clientHeight || canvas.height || height));
    if (w === width && h === height) return;
    width = w;
    height = h;
    canvas.width = w;
    canvas.height = h;
    depthTexture.destroy();
    depthTexture = device.createTexture({
      label: 'depth',
      size: { width: w, height: h },
      format: 'depth24plus',
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
  };

  const frameOnce = (): void => {
    if (disposed) return;
    resize();
    frame.time = (now() - start) / 1000;

    // Build view / proj. Chase camera at a canned offset above the strip.
    const eye = vec3(0, 2.6, 7);
    const target = vec3(0, 0.3, -5);
    const up = vec3(0, 1, 0);
    mat4LookAt(frame.view, eye, target, up);
    mat4Perspective(frame.proj, (58 * Math.PI) / 180, width / height, 0.1, 2000);
    mat4Multiply(frame.viewProj, frame.proj, frame.view);
    frame.camPos[0] = eye[0];
    frame.camPos[1] = eye[1];
    frame.camPos[2] = eye[2];

    packFrameUniforms(frame, uniformScratch);
    device.queue.writeBuffer(frameUniforms, 0, uniformScratch as BufferSource);

    const swapView = context.getCurrentTexture().createView();
    const depthView = depthTexture.createView();
    graph.run(device, swapView, depthView, width, height, frame);

    telemetry.frameStats.frame += 1;
    telemetry.frameStats.dtMs = 0;
    telemetry.renderStats.draws = graph.passes.length;
    telemetry.renderStats.sceneryDraws = telemetry.scenery.drawCount;
    telemetry.renderStats.sceneryDispatch = telemetry.scenery.dispatchCount;
    telemetry.renderStats.sceneryTriangles =
      telemetry.scenery.drawCount * 4 /* two crossed quads per instance */;
    // Keep `__ROWER3D_FOLIAGE` compatible with today's shape — summarise the
    // foliage pool counts rather than reporting per-pool here.
    let trees = 0;
    let meshes = 0;
    for (const p of telemetry.scenery.pools) {
      if (p.kind !== 'foliage') continue;
      trees += p.instanceCount;
      meshes += 1;
    }
    telemetry.foliage.trees = trees;
    telemetry.foliage.meshes = meshes;
    telemetry.foliage.drawn = trees; // GPU cull drawn-count isn't read back every frame.
    telemetry.camera.x = eye[0];
    telemetry.camera.y = eye[1];
    telemetry.camera.z = eye[2];
    telemetry.camera.lookX = target[0];
    telemetry.camera.lookY = target[1];
    telemetry.camera.lookZ = target[2];
  };

  const loop = (): void => {
    if (disposed) return;
    frameOnce();
    const raf = (globalThis as unknown as { requestAnimationFrame?: (cb: () => void) => number })
      .requestAnimationFrame;
    if (raf) {
      rafId = raf(loop);
    }
  };

  telemetry.contextState.kind = 'ready';
  telemetry.contextState.backend = 'webgpu';

  if (opts.testMode) {
    // In test mode we draw one frame and leave scheduling to the caller
    // via `__ROWER3D_FORCE_RENDER()`.
    frameOnce();
  } else {
    loop();
  }

  const renderer: RideRenderer & { _frameOnce: () => void; _telemetry: TelemetryHandles } = {
    _frameOnce: frameOnce,
    _telemetry: telemetry,
    dispose() {
      if (disposed) return;
      disposed = true;
      if (rafId !== null) {
        const cancel = (globalThis as unknown as { cancelAnimationFrame?: (id: number) => void })
          .cancelAnimationFrame;
        cancel?.(rafId);
      }
      graph.dispose();
      for (const pool of scenePools) {
        pool.dispose();
      }
      depthTexture.destroy();
      frameUniforms.destroy();
      session.dispose();
      releaseTelemetry();
      canvas.removeAttribute('data-backend');
    },
  };
  return renderer;
};

export default attach;
