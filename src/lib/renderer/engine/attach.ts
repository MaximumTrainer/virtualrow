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
import { createBuildingsPass } from '../passes/buildings';
import { createCloudsPass } from '../passes/clouds';
import { createSkyPass } from '../passes/sky';
import { createWaterPass } from '../passes/water';
import { createInstancePool, type InstancePool, type PoolInput } from '../plan/instancePools';
import { createBuildingPool, type BuildingPool, type BuildingSpec } from '../plan/buildings';
import { computeCascades } from './cascadedShadows';
import { assetUrl } from '../../utils/assetUrl';
import { createSceneryPass } from './sceneryPass';
import { createSceneryCuller } from '../passes/sceneryCull';
import { createFloraSolidStage } from './floraSolidStage';
import { loadFloraAtlas } from './textureLoader';
import { textureBytes } from './textures';
import { requestDevice, type DeviceSession } from './device';
import { createFrameGraph, type FrameGraph, type FrameUniforms, type Pass } from './frameGraph';
import { publishFallback } from './health';
import { createShadowAtlas } from './shadowAtlas';
import { shadowConfigFor } from './shadowConfig';
import { createShadowStage, type ShadowTelemetry } from './shadowStage';
import { tierCapsFor } from './tierCaps';
import { createTelemetry, releaseTelemetry, type TelemetryHandles } from './telemetry';
import {
  createFrameUniformBuffer,
  createShadowUniformBuffer,
  createSproutUniformBuffer,
  packFrameUniforms,
  packShadowUniforms,
  packSproutUniforms,
  sproutWindowFor,
  type ShadowUniformsCpu,
} from './uniforms';

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
  /**
   * Extruded OSM building footprints to draw as prisms (#566 FR1). Absent
   * on a route with no mapped buildings — the engine then skips the
   * `BuildingsPass` and leaves the sky + clouds + scenery as the only
   * horizon. The engine does not call back into enrichment itself; the
   * UI shell is expected to extrude footprints before passing the route
   * (D1-b).
   */
  buildings?: BuildingSpec[];
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

  // #559 P4: shadow atlas + per-tier cascade config. Default tier is medium
  // (3 cascades @ 1024). `setTier` is a later-phase ask (#559 FR8); for P2
  // we size on attach from opts.tier.
  const shadowCfg = shadowConfigFor(opts.tier);
  const atlas = createShadowAtlas(device, shadowCfg.atlasSize, shadowCfg.cascades);
  telemetry.shadows.atlasSize = atlas.tileSize;
  telemetry.shadows.cascades = atlas.cascades;
  telemetry.shadows.atlasBytes = atlas.bytes;

  const shadowUniformsBuf = createShadowUniformBuffer(device);
  const shadowScratch = new Float32Array(80);
  const shadowCpu: ShadowUniformsCpu = {
    cascadeViewProj: [mat4(), mat4(), mat4(), mat4()],
    cascadeSplits: new Float32Array(4),
    cascadeRadius: new Float32Array(4),
    cascadeBlendStartRatio: 0.1,
    cascadeCount: atlas.cascades,
    tileSize: atlas.tileSize,
    atlasWidth: atlas.width,
  };
  const shadowCmpSampler = device.createSampler({
    label: 'shadow-cmp',
    compare: 'less-equal',
    magFilter: 'linear',
    minFilter: 'linear',
  });

  // Sprout fade uniform (#562 FR6 / D6-b). The window metres are per-tier.
  const sproutUniforms = createSproutUniformBuffer(device);
  const sproutScratch = new Float32Array(4);
  const sprout = sproutWindowFor(opts.tier);
  packSproutUniforms(sprout.near, sprout.far, sproutScratch);
  device.queue.writeBuffer(sproutUniforms, 0, sproutScratch as BufferSource);

  // D7-a of #555: wire the scenery pass unconditionally.
  const sceneryPoolInputs: PoolInput[] = isSceneryRoute(opts.route) ? opts.route.pools : [];
  const scenePools: InstancePool[] = sceneryPoolInputs.map((input) => createInstancePool(device, input));

  // #566 P6 — buildings pool. Per D5-b we skip the pool entirely when the
  // route carries no `buildings`, which is what happens for a fallback
  // enrichment. Tier gates then decide whether to build the pass + cast
  // shadows (D8).
  const tierCaps = tierCapsFor(opts.tier);
  const buildingSpecs: BuildingSpec[] =
    tierCaps.drawBuildings && isSceneryRoute(opts.route) && opts.route.buildings
      ? opts.route.buildings
      : [];
  const buildingsPool: BuildingPool | null = buildingSpecs.length > 0
    ? createBuildingPool(device, buildingSpecs)
    : null;
  const buildingsCastingPool = tierCaps.castBuildingShadows ? buildingsPool : null;
  telemetry.buildings.routes = buildingsPool ? 1 : 0;
  telemetry.buildings.pool = buildingsPool?.instanceCount ?? 0;
  telemetry.buildings.footprintM2 = buildingsPool?.footprintM2 ?? 0;
  telemetry.buildings.resident = !!buildingsPool;
  telemetry.buildings.cast = !!buildingsCastingPool;
  const sceneryPass = createSceneryPass({
    device,
    format,
    frameUniforms,
    sproutUniforms,
    pools: scenePools,
    telemetry: telemetry.scenery,
  });

  // Solid flora stage (#562 FR4 / FR5). Builds a low-poly 3D crown+trunk per
  // foliage pool and renders it alongside the sprite pass with its own cull
  // + indirect, cross-fading via `sproutUniforms`.
  const floraSolidCuller = createSceneryCuller(device);
  const floraSolidStage = createFloraSolidStage({
    device,
    format,
    frameUniforms,
    sproutUniforms,
    culler: floraSolidCuller,
    poolInputs: sceneryPoolInputs,
    spritePools: scenePools,
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

  // Shadow stage before anything lit draws. Its own telemetry writes
  // into `telemetry.shadows` so the per-tile atlas size + per-cascade
  // draw count are visible on `window.__ROWER3D_SHADOWS`.
  const shadowTelemetry: ShadowTelemetry = telemetry.shadows as ShadowTelemetry;
  const shadowStage = createShadowStage({
    device,
    atlas,
    scenePools,
    buildingsPool: buildingsCastingPool,
    telemetry: shadowTelemetry,
  });

  // Lit passes build their own shadow bind groups from
  // `pipeline.getBindGroupLayout(1)` (both passes share the atlas +
  // uniforms + sampler by resource, not by layout).
  const shadowResources = {
    uniforms: shadowUniformsBuf,
    atlasView: atlas.view,
    cmpSampler: shadowCmpSampler,
  };
  const bankPass = createBankPass({ device, format, frameUniforms, shadow: shadowResources });
  const waterPass = createWaterPass({ device, format, frameUniforms, shadow: shadowResources });
  const buildingsPass = createBuildingsPass({
    device,
    format,
    frameUniforms,
    shadow: shadowResources,
    pool: buildingsPool,
    telemetry: telemetry.buildings,
  });
  // Clouds draw after the sky and before the lit passes so the sky's clear
  // is still in place and lit depth writes compose over cloud alpha.
  const cloudsPass = tierCaps.drawClouds
    ? createCloudsPass({ device, format, frameUniforms })
    : null;

  // Pass order (#566): shadowStage → sky → clouds? → bank → buildings →
  // scenery → floraSolid → water.
  const passes: Pass[] = [
    shadowStage,
    createSkyPass({ device, format, frameUniforms }),
    ...(cloudsPass ? [cloudsPass] : []),
    bankPass,
    buildingsPass,
    sceneryPass,
    floraSolidStage,
    waterPass,
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

    // Compute cascades for this frame and update the shadow stage.
    const computed = computeCascades({
      cascades: atlas.cascades,
      near: 0.5,
      far: 400,
      fovY: (58 * Math.PI) / 180,
      aspect: width / height,
      camPos: eye,
      camForward: vec3(target[0] - eye[0], target[1] - eye[1], target[2] - eye[2]),
      camUp: up,
      lightDirection: vec3(-frame.sunDir[0], -frame.sunDir[1], -frame.sunDir[2]),
      lambda: 0.5,
      tileTexels: atlas.tileSize,
    });
    shadowStage.payload.cascadeCount = atlas.cascades;
    for (let i = 0; i < 4; i++) {
      const dst = shadowStage.payload.cascades[i] ?? { viewProj: mat4() };
      shadowStage.payload.cascades[i] = dst;
      if (i < atlas.cascades) {
        dst.viewProj.set(computed.cascades[i].viewProj);
        shadowCpu.cascadeViewProj[i].set(computed.cascades[i].viewProj);
        shadowCpu.cascadeSplits[i] = computed.splits[i] ?? 0;
        shadowCpu.cascadeRadius[i] = computed.cascades[i].radius;
      } else {
        shadowCpu.cascadeViewProj[i].fill(0);
        shadowCpu.cascadeSplits[i] = 0;
        shadowCpu.cascadeRadius[i] = 0;
      }
    }
    shadowCpu.cascadeCount = atlas.cascades;
    packShadowUniforms(shadowCpu, shadowScratch);
    device.queue.writeBuffer(shadowUniformsBuf, 0, shadowScratch as BufferSource);
    telemetry.shadows.lastSplits = Array.from(computed.splits);

    const swapView = context.getCurrentTexture().createView();
    const depthView = depthTexture.createView();
    graph.run(device, swapView, depthView, width, height, frame);

    telemetry.frameStats.frame += 1;
    telemetry.frameStats.dtMs = 0;
    telemetry.renderStats.draws = graph.passes.filter(
      (p) => !p.name.startsWith('shadow'),
    ).length;
    telemetry.renderStats.sceneryDraws = telemetry.scenery.drawCount;
    telemetry.renderStats.sceneryDispatch = telemetry.scenery.dispatchCount;
    telemetry.renderStats.sceneryTriangles =
      telemetry.scenery.spriteDraws * 4 /* two crossed quads per instance */
      + telemetry.scenery.solidTriangles;
    telemetry.renderStats.shadowDraws = telemetry.shadows.draws;
    telemetry.renderStats.shadowTriangles = telemetry.shadows.triangles;
    telemetry.renderStats.shadowAtlasBytes = telemetry.shadows.atlasBytes;
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

  // Lazy flora atlas load (#562 FR2 / FR3). The decoder lives in its own
  // chunk — the engine's main chunk doesn't pull it unless a KTX2 asset is
  // actually fetched. The texture itself is published to telemetry so the
  // smoke can read atlasKind + atlasBytes without a GPU readback.
  type AtlasHandle = Awaited<ReturnType<typeof loadFloraAtlas>>;
  let atlasHandle: AtlasHandle | null = null;
  void loadFloraAtlas(device, opts.tier, {
    url: assetUrl('/assets/flora/atlas'),
    pngWidth: 512,
    pngHeight: 512,
  })
    .then((handle) => {
      atlasHandle = handle;
      telemetry.textures.atlasKind = handle.kind;
      telemetry.textures.transcodedMs = handle.transcodedMs;
      telemetry.textures.mipsGenerated = handle.texture.mipLevelCount;
      const bytesFmt = handle.kind === 'ktx2' ? 'bc7-rgba-unorm-srgb' : 'rgba8unorm-srgb';
      telemetry.textures.atlasBytes = textureBytes(
        handle.texture.width,
        handle.texture.height,
        bytesFmt,
        handle.texture.mipLevelCount,
      );
    })
    .catch(() => {
      // Loader guards everything; this is belt-and-braces so a rejected
      // dynamic-import can't take the engine down.
      telemetry.textures.atlasKind = 'placeholder';
    });

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
      buildingsPool?.dispose();
      floraSolidCuller.dispose();
      depthTexture.destroy();
      frameUniforms.destroy();
      shadowUniformsBuf.destroy();
      sproutUniforms.destroy();
      atlasHandle?.texture.dispose();
      atlas.dispose();
      session.dispose();
      releaseTelemetry();
      canvas.removeAttribute('data-backend');
    },
  };
  return renderer;
};

export default attach;
