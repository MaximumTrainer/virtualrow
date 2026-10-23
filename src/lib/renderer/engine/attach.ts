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

import { mat4, mat4Identity, mat4LookAt, mat4Multiply, mat4Perspective, mat4FromRotationY, type Mat4 } from '../math/mat4';
import { vec3 } from '../math/vec3';
import { cameraTarget, createRigTarget } from './camera';
import { createBankPass } from '../passes/bank';
import { createBoatPass } from '../passes/boat';
import { createBuildingsPass } from '../passes/buildings';
import { createCloudsPass } from '../passes/clouds';
import { createSkyPass } from '../passes/sky';
import { createWaterPass } from '../passes/water';
import { createSceneryMeshPass } from '../passes/sceneryMesh';
import { loadGlb } from '../../scenery/glbLoader';
import {
  placeFurniture,
  type FurniturePlacement,
  type SceneryModelId,
} from '../../scenery/courseFurniture';
import { createInstancePool, type InstancePool, type PoolInput } from '../plan/instancePools';
import { createBuildingPool, type BuildingPool, type BuildingSpec } from '../plan/buildings';
import { BOAT_BONE_COUNT, BOAT_BONE_ARMS, BOAT_BONE_HEAD, BOAT_BONE_HULL, BOAT_BONE_TORSO } from '../plan/boatMesh';
import { loadBoatMesh } from '../plan/boatMeshLoader';
import { computeCascades } from './cascadedShadows';
import { createPlacement, placeBoat, placeGhost, strokePhase, strokeAmplitude } from './characterPlacement';
import type { RideFrame } from './rideFrame';
import { RouteCurve } from '../math/curve';
import { GHOST_LANE_OFFSET_M } from '../../../components/rower3d/ghost';
import { assetUrl } from '../../utils/assetUrl';
import { createSceneryPass } from './sceneryPass';
import { paintFoliage, FOLIAGE_SHAPES } from '../../scenery/foliageTexture';
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
import { createTelemetry, publishSpeedMps, releaseTelemetry, type TelemetryHandles } from './telemetry';
import { createPostFx, type PostFxCaps } from './postFx';
import {
  createFrameUniformBuffer,
  createShadowUniformBuffer,
  createSproutUniformBuffer,
  FRAME_UNIFORMS_FLOATS,
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
  /**
   * Points of the route curve in world space (#570 D6). Absent on the
   * smoke pages — the engine falls back to a short straight-line curve so
   * the boat still has a route to run on.
   */
  curvePoints?: readonly [number, number, number][];
  /** Metres represented by the full curve (defaults to the chord length). */
  totalDistanceMeters?: number;
  /**
   * Loop routes wrap at the ends rather than mirroring virtual endpoints;
   * omitted or false means an open route. Mirrors `createRouteCurve`'s
   * closed-loop detection in the React scene (`src/components/rower3d/curve.ts`).
   */
  isClosedLoop?: boolean;
  /**
   * GLB scenery (bank-edge, scatter, buildings, trees, landform, backdrop,
   * course furniture, bridges, landmarks) — one group per model id, with
   * per-instance world-space transforms. The adapter computes the layout;
   * attach loads each referenced GLB and feeds instances into the registry.
   */
  sceneryGlbs?: Array<{
    id: string;
    instances: Array<{ position: [number, number, number]; rotationY: number; scale: number }>;
  }>;
  /**
   * Per-progress shore widths (scene units) so the water strip bends with
   * the OSM-measured river. Called once per vertex column at build time, not
   * per frame. Omitted → symmetric `WATER_CHANNEL_HALF_WIDTH`.
   */
  waterEdgesForProgress?: (progress: number) => { left: number; right: number };
}

export const isSceneryRoute = (route: unknown): route is SceneryRoute =>
  !!route && typeof route === 'object' && Array.isArray((route as SceneryRoute).pools);

export type RideAttachOpts = {
  tier?: string;
  route?: unknown;
  testMode?: boolean;
  /**
   * Per-frame data from the UI shell (#570 FR7). Optional — the smoke
   * pages pass no frame and the engine falls back to a canned chase
   * camera. The engine never caches a `RideFrame`; it calls `getFrame`
   * once per rendered frame and reads the returned object.
   */
  getFrame?: () => RideFrame;
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

  const outputFormat: GPUTextureFormat =
    (navigator as unknown as { gpu?: GPU }).gpu?.getPreferredCanvasFormat?.() ?? 'bgra8unorm';
  context.configure({ device, format: outputFormat, alphaMode: 'opaque' });
  // #573 P8 — the lit passes render into an HDR offscreen target; PostFxPass
  // composites to the real swap-chain. The `format` prop every lit pass takes
  // is this HDR format; `outputFormat` is only used by the composite + DOF
  // target configs inside PostFxPass.
  const format: GPUTextureFormat = 'rgba16float';

  let width = Math.max(1, Math.floor(canvas.clientWidth || canvas.width || 320));
  let height = Math.max(1, Math.floor(canvas.clientHeight || canvas.height || 240));
  canvas.width = width;
  canvas.height = height;

  // Scene HDR colour target (#573 FR1 / D1-a).
  let sceneTexture = device.createTexture({
    label: 'scene-hdr',
    size: { width, height },
    format,
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
  });

  // Depth is `depth32float` from P8 so SSAO + DOF can sample it (#573 FR9).
  let depthTexture = device.createTexture({
    label: 'depth',
    size: { width, height },
    format: 'depth32float',
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
  });

  const frameUniforms = createFrameUniformBuffer(device);
  const uniformScratch = new Float32Array(FRAME_UNIFORMS_FLOATS);

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
  // Per-species leaf atlas (#549 slice 3). Three 256×256 RGBA layers (one per
  // FoliageShape); `paintFoliage` generates the pixels, the fragment shader
  // samples by species index. The pass alpha-tests transparent texels so the
  // crossed quads read as individual trees instead of flat cards.
  const foliageAtlasSize = 256;
  const foliageAtlasLayers = FOLIAGE_SHAPES.length;
  const foliageAtlasTex = device.createTexture({
    label: 'foliage-atlas',
    size: { width: foliageAtlasSize, height: foliageAtlasSize, depthOrArrayLayers: foliageAtlasLayers },
    format: 'rgba8unorm-srgb',
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  });
  // writeTexture is on the real GPUQueue but not on the attach-test mock;
  // skipping the upload leaves the atlas blank there, which is fine — no
  // test depends on the leaf texture's content.
  if (typeof device.queue.writeTexture === 'function') {
    for (let layer = 0; layer < foliageAtlasLayers; layer += 1) {
      const pixels = paintFoliage(FOLIAGE_SHAPES[layer], foliageAtlasSize);
      device.queue.writeTexture(
        { texture: foliageAtlasTex, origin: { x: 0, y: 0, z: layer } },
        pixels as BufferSource,
        { bytesPerRow: foliageAtlasSize * 4, rowsPerImage: foliageAtlasSize },
        { width: foliageAtlasSize, height: foliageAtlasSize, depthOrArrayLayers: 1 },
      );
    }
  }
  const foliageAtlasView = foliageAtlasTex.createView({ dimension: '2d-array' });
  const foliageSampler = device.createSampler({
    label: 'foliage',
    magFilter: 'linear',
    minFilter: 'linear',
    mipmapFilter: 'linear',
    addressModeU: 'clamp-to-edge',
    addressModeV: 'clamp-to-edge',
  });

  const sceneryPass = createSceneryPass({
    device,
    format,
    frameUniforms,
    sproutUniforms,
    pools: scenePools,
    telemetry: telemetry.scenery,
    foliageAtlasView,
    foliageSampler,
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

  // #570 P7 D1-b — prefer the baked `shell.bin` buffer from
  // `scripts/build-boat-mesh.mjs`; the procedural generator in `boatMesh.ts`
  // is the deterministic fallback for SSR, tests, and fetch failures so the
  // smoke silhouette is identical either way. Telemetry carries which path
  // won on `__ROWER3D_BOAT.meshSource`.
  const boatMeshHandle = await loadBoatMesh({ url: assetUrl('/assets/boat/shell.bin') });
  const boatMesh = boatMeshHandle.mesh;
  telemetry.boat.meshSource = boatMeshHandle.source;
  const boatPass = createBoatPass({ device, format, frameUniforms, mesh: boatMesh });
  const charactersMesh = tierCaps.castCharacterShadows ? boatMesh : null;

  // Scenery-mesh pass. Loads the course-furniture GLBs and keeps a registry
  // keyed by `SceneryModelId`; `placeFurniture` (called below once the route
  // curve is known) feeds the per-instance mat4 buffers each attach. The
  // same pass also hosts the per-frame boat GLB — scull.glb has 19 primitives
  // with distinct materials (hull vs rower vs oars), each registered as its
  // own mesh id so the per-primitive base colours survive.
  const sceneryMeshPass = createSceneryMeshPass({ device, format, frameUniforms });
  const BOAT_SCULL_PREFIX = 'boat-scull';
  const boatScullMeshIds: string[] = [];
  const COURSE_FURNITURE_MODELS: SceneryModelId[] = [
    'a01-buoy-lane-sphere',
    'a06-finish-tower',
    'a07-distance-marker-post',
  ];
  // Full set of GLB ids this route references: the fixed course furniture
  // plus everything `computePlacements` + `computeStructurePlacements`
  // asked for on the adapter side.
  const sceneryGlbList = isSceneryRoute(opts.route) ? opts.route.sceneryGlbs ?? [] : [];
  const allModelIds: Set<string> = new Set<string>(COURSE_FURNITURE_MODELS);
  for (const group of sceneryGlbList) allModelIds.add(group.id);
  // Fixed per-GLB ceiling. Routes we ship touch at most ~900 instances per
  // bank for the heaviest category; 1024 keeps the GPU buffer size stable
  // through a route switch without reallocating.
  const COURSE_FURNITURE_MAX_INSTANCES = 1024;
  // Where in the asset tree a given model id lives. All scenery GLBs are
  // under `public/assets/scenery/tier-{a..g,l}/`; we figure out the folder
  // from the id's first character.
  const tierFolderFor = (id: string): string => {
    const prefix = id[0]?.toLowerCase() ?? 'a';
    const tier = 'abcdefgl'.includes(prefix) ? prefix : 'a';
    return `tier-${tier}`;
  };
  // Load the scull GLB (one primitive registered per material so the hull's
  // grey, the rower's warmer tone and the oars' tint all survive). Each
  // primitive gets the same per-frame instance matrix. The old baked
  // `shell.bin` stays loaded as the test-mode / load-failure fallback,
  // mirroring React's Suspense fallback shape.
  try {
    // scull-male.glb has the crewed hero (scull + rower + oars + riggers,
    // 155 KB, 45 meshes); scull.glb is the empty hull (68 KB, no crew).
    // The rower appearance seam is in `useCrewPreference`/`useRowerAppearance`
    // but doesn't yet reach the engine attach — default to male; follow-up
    // slice can read the preference and pick scull-female.glb when set.
    const res = await fetch(assetUrl('/assets/boat/scull-male.glb'));
    if (res.ok) {
      const bytes = new Uint8Array(await res.arrayBuffer());
      const model = await loadGlb(bytes);
      for (let i = 0; i < model.primitives.length; i += 1) {
        const prim = model.primitives[i];
        const id = `${BOAT_SCULL_PREFIX}:${i}`;
        sceneryMeshPass.register({
          id,
          positions: prim.positions,
          normals: prim.normals,
          indices: prim.indices,
          baseColor: prim.baseColor,
          maxInstances: 1,
        });
        boatScullMeshIds.push(id);
      }
    }
  } catch { /* scull GLB load failed — the old baked boat remains as fallback */ }

  await Promise.all([...allModelIds].map(async (id) => {
    try {
      const url = assetUrl(`/assets/scenery/${tierFolderFor(id)}/${id}.glb`);
      const res = await fetch(url);
      if (!res.ok) return;
      const bytes = new Uint8Array(await res.arrayBuffer());
      const model = await loadGlb(bytes);
      // Concatenate the model's primitives into one vertex/index set per
      // registered id — the pass doesn't need per-primitive materials for
      // course furniture, and reusing one id/one bind group keeps the draw
      // list short.
      let posTotal = 0;
      let nrmTotal = 0;
      let idxTotal = 0;
      for (const p of model.primitives) {
        posTotal += p.positions.length;
        nrmTotal += p.normals.length;
        idxTotal += p.indices.length;
      }
      const positions = new Float32Array(posTotal);
      const normals = new Float32Array(nrmTotal);
      const needs32 = model.primitives.some((p) => p.indices instanceof Uint32Array);
      const indices = needs32 ? new Uint32Array(idxTotal) : new Uint16Array(idxTotal);
      let pOff = 0;
      let nOff = 0;
      let iOff = 0;
      let vertBase = 0;
      for (const p of model.primitives) {
        positions.set(p.positions, pOff);
        normals.set(p.normals, nOff);
        for (let i = 0; i < p.indices.length; i += 1) indices[iOff + i] = p.indices[i] + vertBase;
        pOff += p.positions.length;
        nOff += p.normals.length;
        iOff += p.indices.length;
        vertBase += p.positions.length / 3;
      }
      sceneryMeshPass.register({
        id,
        positions,
        normals,
        indices,
        baseColor: model.primitives[0]?.baseColor ?? [1, 1, 1, 1],
        maxInstances: COURSE_FURNITURE_MAX_INSTANCES,
      });
    } catch {
      // A fetch or decode failure leaves the model unregistered; the pass
      // silently skips it rather than taking the engine down.
    }
  }));

  // Build the water/bank curve + edges fn FIRST so every geometry pass
  // that follows the river (water strip, bank strips lit + depth, boat
  // placement, course furniture, camera) can share one spline.
  const waterCurveSource = isSceneryRoute(opts.route) && opts.route.curvePoints && opts.route.curvePoints.length >= 2
    ? opts.route.curvePoints
    : [[0, 0, 0] as [number, number, number], [0, 0, -200] as [number, number, number]];
  const waterCurve = new RouteCurve(
    waterCurveSource.map(([x, y, z]) => vec3(x, y, z)),
    isSceneryRoute(opts.route) ? !!opts.route.isClosedLoop : false,
  );
  const waterEdgesForProgress = isSceneryRoute(opts.route) ? opts.route.waterEdgesForProgress : undefined;

  // Shadow stage before anything lit draws. Its own telemetry writes
  // into `telemetry.shadows` so the per-tile atlas size + per-cascade
  // draw count are visible on `window.__ROWER3D_SHADOWS`.
  const shadowTelemetry: ShadowTelemetry = telemetry.shadows as ShadowTelemetry;
  const shadowStage = createShadowStage({
    device,
    atlas,
    scenePools,
    buildingsPool: buildingsCastingPool,
    charactersMesh,
    boatPass,
    telemetry: shadowTelemetry,
    bankCurve: waterCurve,
    bankEdgesForProgress: waterEdgesForProgress,
  });

  // Lit passes build their own shadow bind groups from
  // `pipeline.getBindGroupLayout(1)` (both passes share the atlas +
  // uniforms + sampler by resource, not by layout).
  const shadowResources = {
    uniforms: shadowUniformsBuf,
    atlasView: atlas.view,
    cmpSampler: shadowCmpSampler,
  };
  const bankPass = createBankPass({
    device,
    format,
    frameUniforms,
    shadow: shadowResources,
    curve: waterCurve,
    edgesForProgress: waterEdgesForProgress,
  });
  const waterPass = createWaterPass({
    device,
    format,
    frameUniforms,
    shadow: shadowResources,
    curve: waterCurve,
    edgesForProgress: waterEdgesForProgress,
  });
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

  // #573 P8 — PostFx. Reads the HDR scene + depth; writes to the swap-chain.
  const postCaps: PostFxCaps = {
    bloom: tierCaps.drawBloom,
    tone: true,
    vignette: tierCaps.drawVignette,
    lut: tierCaps.drawLut,
    ssao: tierCaps.drawSsao,
    dof:
      tierCaps.drawDof &&
      !!(globalThis as unknown as { window?: { __VIRTUALROW_POSTFX_DOF?: boolean } }).window
        ?.__VIRTUALROW_POSTFX_DOF,
  };
  const postFx = createPostFx({ device, sceneFormat: format, outputFormat, caps: postCaps });
  postFx.setInputs({
    sceneView: sceneTexture.createView(),
    sceneTexture,
    depthView: depthTexture.createView(),
    width,
    height,
  });

  // Pass order (#570 extends #566; #573 appends post-fx): shadowStage → sky
  // → clouds? → bank → buildings → scenery → floraSolid → water → boat →
  // postFx. The lit passes write to the HDR offscreen (`ctx.swapView` is the
  // scene texture view). PostFx reads the HDR scene + depth and composites
  // to `ctx.outputView` (the real swap-chain back-buffer).
  const passes: Pass[] = [
    shadowStage,
    createSkyPass({ device, format, frameUniforms }),
    ...(cloudsPass ? [cloudsPass] : []),
    bankPass,
    buildingsPass,
    sceneryPass,
    floraSolidStage,
    waterPass,
    boatPass,
    sceneryMeshPass,
    postFx.pass,
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

  // Route curve for boat / ghost placement. Reuses `waterCurve` so boat
  // and water share one spline, i.e. the boat always rides the water's
  // centreline. On a smoke page without a route this is a 200 m straight
  // line heading −z so the engine still has a curve to sample
  // (`placeBoat` falls back to origin when the curve is null, which it
  // never is here).
  const routeCurve = waterCurve;
  const curveLength = routeCurve.approximateLength(32);
  const totalDistanceMeters =
    isSceneryRoute(opts.route) && typeof opts.route.totalDistanceMeters === 'number'
      ? Math.max(1, opts.route.totalDistanceMeters)
      : Math.max(1, curveLength);
  telemetry.route.hasCurve = true;
  telemetry.route.totalDistance = totalDistanceMeters;
  telemetry.route.curveLength = curveLength;

  // Place course furniture along the real route curve and feed the
  // per-model instance buffers once at attach — this scene isn't dynamic,
  // so there's no reason to re-send the mat4s every frame.
  const furniture: FurniturePlacement[] = placeFurniture({
    curve: routeCurve,
    routeMeters: totalDistanceMeters,
    shoreHalfWidth: (progress, side) => {
      if (!waterEdgesForProgress) return 10;
      const edges = waterEdgesForProgress(progress);
      return side === 'left' ? edges.left : edges.right;
    },
  });
  const byModel = new Map<SceneryModelId, Mat4[]>();
  for (const model of COURSE_FURNITURE_MODELS) byModel.set(model, []);
  // Scenery GLBs are authored in millimetres and the loader bakes the
  // node transform into metres-of-the-mesh; `ASSET_SCALE = 0.001` brings
  // them back to scene units (matches `sceneryPlacement.ts`'s React path).
  const ASSET_SCALE = 0.001;
  for (const place of furniture) {
    const trs = mat4();
    const rot = mat4();
    const t = mat4();
    mat4FromRotationY(rot, place.rotationY);
    // Build TRS = T · R · S by hand so the uniform scale lands on the
    // mesh before the rotation applies — the engine's math/ helpers don't
    // ship a mat4FromScale yet.
    rot[0] *= ASSET_SCALE; rot[1] *= ASSET_SCALE; rot[2] *= ASSET_SCALE;
    rot[4] *= ASSET_SCALE; rot[5] *= ASSET_SCALE; rot[6] *= ASSET_SCALE;
    rot[8] *= ASSET_SCALE; rot[9] *= ASSET_SCALE; rot[10] *= ASSET_SCALE;
    mat4Identity(t);
    t[12] = place.position[0];
    t[13] = place.position[1];
    t[14] = place.position[2];
    mat4Multiply(trs, t, rot);
    byModel.get(place.id)?.push(trs);
  }
  for (const model of COURSE_FURNITURE_MODELS) {
    sceneryMeshPass.setInstances(model, byModel.get(model) ?? []);
  }

  // Full-scene GLB scenery (bank-edge, scatter, buildings, trees, landform,
  // backdrop, bridges, landmarks, finish-area furniture). Instances come
  // pre-computed from the UI adapter so this is a straight transform-build
  // + setInstances per model id.
  for (const group of sceneryGlbList) {
    const mats: Mat4[] = [];
    for (const inst of group.instances) {
      const trs = mat4();
      const rot = mat4();
      const t = mat4();
      mat4FromRotationY(rot, inst.rotationY);
      // T · (R · S) built by hand — see the course-furniture block above.
      rot[0] *= inst.scale; rot[1] *= inst.scale; rot[2] *= inst.scale;
      rot[4] *= inst.scale; rot[5] *= inst.scale; rot[6] *= inst.scale;
      rot[8] *= inst.scale; rot[9] *= inst.scale; rot[10] *= inst.scale;
      mat4Identity(t);
      t[12] = inst.position[0];
      t[13] = inst.position[1];
      t[14] = inst.position[2];
      mat4Multiply(trs, t, rot);
      mats.push(trs);
    }
    sceneryMeshPass.setInstances(group.id, mats);
  }

  // Chase camera rig state, driven by `cameraTarget` each frame. Allocated
  // once so the FOV/position/lookAt don't retain stale per-frame GC pressure.
  const cameraRig = createRigTarget();
  const boatPlacement = createPlacement();
  const ghostPlacement = createPlacement();
  const boatBones = [mat4(), mat4(), mat4(), mat4()];
  const ghostBones = [mat4(), mat4(), mat4(), mat4()];
  for (let i = 0; i < BOAT_BONE_COUNT; i++) {
    mat4Identity(boatBones[i]);
    mat4Identity(ghostBones[i]);
  }
  const BOAT_TINT = new Float32Array([0.78, 0.78, 0.82, 1.0]);
  const GHOST_TINT = new Float32Array([0.35, 0.85, 1.0, 0.5]);

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
      format: 'depth32float',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    sceneTexture.destroy();
    sceneTexture = device.createTexture({
      label: 'scene-hdr',
      size: { width: w, height: h },
      format,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    postFx.setInputs({
      sceneView: sceneTexture.createView(),
      sceneTexture,
      depthView: depthTexture.createView(),
      width: w,
      height: h,
    });
  };

  // Per-frame boat speed is derived from the distanceMeters delta, so the
  // frame loop keeps the previous reading across calls.
  let lastDistanceMeters = 0;
  let lastSpeedTime = -1;

  const frameOnce = (): void => {
    if (disposed) return;
    resize();
    frame.time = (now() - start) / 1000;

    // #570 P7 — if the UI shell provided `getFrame`, pull the ride state.
    const rideFrame: RideFrame | null = opts.getFrame ? opts.getFrame() : null;

    // Boat + ghost placement, run before the camera so the chase camera can
    // follow the boat on later phases (P7 keeps the canned camera; the
    // follow-camera lands in #556).
    placeBoat(boatPlacement, routeCurve, rideFrame, totalDistanceMeters, curveLength, 0);
    const ghostInfo = placeGhost(
      ghostPlacement,
      routeCurve,
      rideFrame?.ghost ?? null,
      rideFrame?.elapsedSeconds ?? frame.time,
      totalDistanceMeters,
      curveLength,
      -GHOST_LANE_OFFSET_M,
    );

    // Analytic sinusoid stroke driver (D3-a). Hull bone stays identity so
    // the hull itself does not sway; torso / arms / head rotate about the
    // seat with the stroke phase. Oar feather uses rotation.x in YXZ (D4-a)
    // which we apply on the arms bone directly.
    const phase = strokePhase(rideFrame?.cadence ?? 0, frame.time, rideFrame?.isPlaying ?? false);
    const amp = strokeAmplitude(rideFrame);
    // Simple torso-lean + arm-pull sinusoid; keep amplitudes small so the
    // crew visibly moves at tier basic without looking cartoonish.
    const torsoLean = Math.sin(phase * Math.PI * 2) * 0.35 * amp;
    const armPull = Math.sin(phase * Math.PI * 2 + 0.5) * 0.6 * amp;
    const headNod = Math.sin(phase * Math.PI * 2) * 0.1 * amp;
    mat4Identity(boatBones[BOAT_BONE_HULL]);
    mat4FromRotationY(boatBones[BOAT_BONE_TORSO], torsoLean);
    mat4FromRotationY(boatBones[BOAT_BONE_ARMS], armPull);
    mat4FromRotationY(boatBones[BOAT_BONE_HEAD], headNod);
    // Ghost stays rigid: its purpose is a silhouette to chase.
    for (let i = 0; i < BOAT_BONE_COUNT; i++) mat4Identity(ghostBones[i]);

    // Upload boat / ghost uniforms. Visibility: crew-casting + crew drawing
    // are tier-gated inside `boatPass.boatVisible` isn't the right lever
    // (that silences the hull too); the crew bone trio stays identity when
    // `tierCaps.drawCrew === false`, so basic's "no crew" is "frozen crew"
    // rather than invisible — the hull still draws.
    if (!tierCaps.drawCrew) {
      mat4Identity(boatBones[BOAT_BONE_TORSO]);
      mat4Identity(boatBones[BOAT_BONE_ARMS]);
      mat4Identity(boatBones[BOAT_BONE_HEAD]);
    }
    // The GLB scull takes over the hero draw when it loaded successfully;
    // the old minimal baked shell stays resident for shadow-casting and the
    // ghost chaser. If the GLB didn't load, keep the baked boat visible so
    // the user still sees something.
    const scullLoaded = boatScullMeshIds.length > 0;
    boatPass.boatVisible.value = !scullLoaded;
    boatPass.ghostVisible.value = ghostInfo !== null;

    if (scullLoaded) {
      // One mat4 = translation at the boat's world position * rotation
      // about Y to face the route tangent. Boat world Y already includes
      // the BOAT_HEIGHT_Y freeboard, so the GLB (pivot at hull waterline
      // per `public/assets/boat/README.md`) sits above the water surface.
      const scullTrs = mat4();
      const scullRot = mat4();
      const scullTrans = mat4();
      mat4FromRotationY(scullRot, boatPlacement.heading);
      mat4Identity(scullTrans);
      scullTrans[12] = boatPlacement.world[0];
      scullTrans[13] = boatPlacement.world[1];
      scullTrans[14] = boatPlacement.world[2];
      mat4Multiply(scullTrs, scullTrans, scullRot);
      for (const id of boatScullMeshIds) {
        sceneryMeshPass.setInstances(id, [scullTrs]);
      }
    }
    boatPass.boat.write(device, {
      model: boatPlacement.modelMatrix,
      bones: boatBones,
      tintRGBA: BOAT_TINT,
      ghost: false,
      visible: true,
    });
    if (ghostInfo) {
      boatPass.ghost.write(device, {
        model: ghostPlacement.modelMatrix,
        bones: ghostBones,
        tintRGBA: GHOST_TINT,
        ghost: true,
        visible: true,
      });
    }

    // Publish telemetry for the HUD / specs.
    telemetry.boat.x = boatPlacement.world[0];
    telemetry.boat.y = boatPlacement.world[1];
    telemetry.boat.z = boatPlacement.world[2];
    telemetry.boat.heading = boatPlacement.heading;
    telemetry.boat.distanceMeters = boatPlacement.distanceMeters;
    telemetry.boat.progress = boatPlacement.progress;
    telemetry.boat.holding = !!rideFrame?.holdBoat;
    telemetry.boat.finished = !!rideFrame?.finished;
    telemetry.boat.isPlaying = !!rideFrame?.isPlaying;

    // Boat speed (m/s): the world-scale spec reads __ROWER3D_SPEED_MPS. Compute
    // from the distanceMeters delta divided by frame time; hold at 0 while the
    // boat is paused or in countdown so the scalar stays flat.
    let speedMps = 0;
    if (!telemetry.boat.holding && !telemetry.boat.finished && telemetry.boat.isPlaying) {
      if (lastSpeedTime >= 0) {
        const dt = Math.max(1e-3, frame.time - lastSpeedTime);
        const dd = telemetry.boat.distanceMeters - lastDistanceMeters;
        speedMps = Math.max(0, dd / dt);
      }
    }
    lastDistanceMeters = telemetry.boat.distanceMeters;
    lastSpeedTime = frame.time;
    publishSpeedMps(telemetry, speedMps);
    telemetry.pos.x = boatPlacement.world[0];
    telemetry.pos.y = boatPlacement.world[1];
    telemetry.pos.z = boatPlacement.world[2];
    telemetry.pos.progress = boatPlacement.progress;
    telemetry.crew.cadenceSpm = Math.max(0, rideFrame?.cadence ?? 0);
    telemetry.crew.strokePhase = phase;
    telemetry.crew.amplitude = amp;
    telemetry.crew.rowers = 1;
    if (ghostInfo) {
      telemetry.ghostMeters.value = ghostInfo.metres;
      telemetry.ghostMeters.active = true;
    } else {
      telemetry.ghostMeters.value = 0;
      telemetry.ghostMeters.active = false;
    }

    // Build view / proj. Chase camera follows the boat along the curve — on
    // smoke pages where the boat isn't driven, it falls back to the canned
    // over-the-shoulder stand-in (the fallback goes through `cameraTarget`
    // too so the rig has one code path).
    const camBoat = vec3(boatPlacement.world[0], boatPlacement.world[1], boatPlacement.world[2]);
    const camTangent = vec3();
    // Tangent at the boat's progress — the chase camera sits −tangent * back.
    const camSample = routeCurve.sample(boatPlacement.progress);
    camTangent[0] = camSample.tangent[0];
    camTangent[1] = camSample.tangent[1];
    camTangent[2] = camSample.tangent[2];
    cameraTarget(
      { boat: camBoat, tangent: camTangent, velocityMps: speedMps, view: 'chase', bendSign: 0 },
      cameraRig,
    );
    const eye = cameraRig.position;
    const target = cameraRig.lookAt;
    const up = vec3(0, 1, 0);
    mat4LookAt(frame.view, eye, target, up);
    mat4Perspective(frame.proj, (cameraRig.fov * Math.PI) / 180, width / height, 0.1, 2000);
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

    // Lit passes write to the HDR scene view; PostFx composites to the
    // real swap-chain back-buffer (#573 P8 FR1 + FR2).
    const outputView = context.getCurrentTexture().createView();
    const sceneView = sceneTexture.createView();
    const depthView = depthTexture.createView();
    graph.run(device, sceneView, depthView, width, height, frame, outputView);

    telemetry.frameStats.frame += 1;
    telemetry.frameStats.dtMs = 0;
    // Count scene colour passes as they encode: skip the shadow stage, skip
    // the boat pass if neither boat nor ghost drew this frame, and skip the
    // post-fx stage (its own sub-pass count is tracked internally; the
    // scene `draws` number must stay the "N lit passes" invariant that
    // existing specs assert).
    let draws = 0;
    for (const p of graph.passes) {
      if (p.name.startsWith('shadow')) continue;
      if (p.name === 'postfx') continue;
      if (p.name === 'boat' && !boatPass.boatVisible.value && !boatPass.ghostVisible.value) continue;
      draws += 1;
    }
    telemetry.renderStats.draws = draws;
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
      postFx.dispose();
      sceneTexture.destroy();
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
