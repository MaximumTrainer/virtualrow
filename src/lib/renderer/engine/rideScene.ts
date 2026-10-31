/**
 * Per-device scene state for the WebGPU engine. Extracted from `attach.ts`
 * so #584 FR1's device-lost reattach loop can rebuild it on a fresh device
 * without rewriting `attach`'s orchestration.
 *
 * The split: `attach` owns the canvas, telemetry, outer render loop, and
 * device session lifecycle; `createRideScene` owns everything that lives
 * on a given `GPUDevice` — textures, buffers, pipelines, pools, passes,
 * the frame graph, and the per-frame encoder. On a loss, `attach` disposes
 * the current scene and calls `createRideScene` again with the new device
 * (D1-a of #584).
 *
 * The return value is intentionally small — a `frameOnce` the outer loop
 * calls, a `dispose` that releases every GPU resource the scene owns, and
 * a few shim refs the test harness reads.
 */

/// <reference types="@webgpu/types" />

import {
  mat4,
  mat4Identity,
  mat4LookAt,
  mat4Multiply,
  mat4Perspective,
  mat4FromRotationY,
  type Mat4,
} from '../math/mat4';
import { vec3 } from '../math/vec3';
import { cameraTarget, createRigTarget } from './camera';
import { createBankPass } from '../passes/bank';
import { createBoatPass } from '../passes/boat';
import { createBuildingsPass } from '../passes/buildings';
import { createCloudsPass } from '../passes/clouds';
import { boatTintFromAthlete } from './boatPaint';
import { createRainOverlayPass } from '../passes/rainOverlay';
import { createWakeParticlesPass } from '../passes/wakeParticles';
import { createWakeState, updateWake } from './wakeParticles';
import { createOarSplashPass } from '../passes/oarSplashParticles';
import { createOarSplashState, updateOarSplash } from './oarSplashParticles';
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
import {
  BOAT_BONE_COUNT,
  BOAT_BONE_ARMS,
  BOAT_BONE_HEAD,
  BOAT_BONE_HULL,
  BOAT_BONE_TORSO,
} from '../plan/boatMesh';
import { loadBoatMesh } from '../plan/boatMeshLoader';
import { computeCascades } from './cascadedShadows';
import { createPlacement, placeBoat, placeGhost, strokePhase, strokeAmplitude } from './characterPlacement';
import { createDistanceSmoother } from './distanceSmoother';
import type { RideFrame } from './rideFrame';
import { RouteCurve } from '../math/curve';
import { GHOST_LANE_OFFSET_M } from '../../../components/rower3d/ghost';
import { assetUrl } from '../../utils/assetUrl';
import { createSceneryPass } from './sceneryPass';
import { mergeSceneryPrimitives, scaleMeshColors, VEGETATION_ALBEDO_GAIN } from './sceneryMeshBuffers';
import {
  planSceneryStream,
  sceneryModelsToLoad,
  type CurveDistanceSample,
} from './sceneryStreamPlan';
import { paintFoliage, FOLIAGE_SHAPES } from '../../scenery/foliageTexture';
import { createSceneryCuller } from '../passes/sceneryCull';
import { createFloraSolidStage } from './floraSolidStage';
import { loadFloraAtlas } from './textureLoader';
import { textureBytes } from './textures';
import { createFrameGraph, type FrameGraph, type FrameUniforms, type Pass } from './frameGraph';
import { createGpuFrameTimer } from './gpuFrameTimer';
import { createShadowAtlas } from './shadowAtlas';
import { shadowConfigFor } from './shadowConfig';
import { shaderGrassStrengthFor } from './shaderGrass';
import type { PerformanceMode } from '../../scenery/sceneryPlacement';
import type { SceneryProfile } from '../../services/routeEnrichmentService';
import { createShadowStage, type ShadowTelemetry } from './shadowStage';
import { tierCapsFor } from './tierCaps';
import { publishSpeedMps, type TelemetryHandles } from './telemetry';
import { createPostFx, type PostFxCaps } from './postFx';
import {
  createFrameUniformBuffer,
  createShadowUniformBuffer,
  createSproutUniformBuffer,
  fogDistanceScaleFor,
  FRAME_UNIFORMS_FLOATS,
  packFrameUniforms,
  packShadowUniforms,
  packSproutUniforms,
  sproutWindowFor,
  type ShadowUniformsCpu,
} from './uniforms';

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
  /**
   * Dominant biome profile along the route — the bank pass's grass-density
   * tile (#496 Phase 2) is baked from this. One profile per route for now;
   * per-segment banks are a follow-up.
   */
  dominantProfile?: string;
}

export const isSceneryRoute = (route: unknown): route is SceneryRoute =>
  !!route && typeof route === 'object' && Array.isArray((route as SceneryRoute).pools);

export interface RideSceneOpts {
  tier?: string;
  /**
   * #591-fu P2c: a separate "view distance" tier that caps LOD / fog /
   * sprout window / scenery stream look-ahead independently of the main
   * quality tier. Omitted falls back to `tier` so a single-tier caller
   * keeps the pre-split behaviour.
   */
  distanceTier?: string;
  route?: unknown;
  getFrame?: () => RideFrame;
  crew?: 'male' | 'female';
  /** #571 — stable athlete identifier. When supplied, drives the shell
   *  paint tint via `boatPaint.boatTintFromAthlete`. Omitted / empty =
   *  the pre-#571 off-white default. */
  athleteId?: string;
}

export interface RideSceneHandle {
  readonly device: GPUDevice;
  /** Draw one frame. The outer rAF loop (or the test harness) calls this. */
  frameOnce(): void;
  /**
   * Release every GPU resource this scene owns, including the device
   * session that owns the `GPUDevice`. Safe to call more than once.
   */
  dispose(): void;
}

/** Internal clock used by the test harness. */
const now = (): number =>
  typeof performance !== 'undefined' ? performance.now() : Date.now();

/**
 * Build the per-device scene on `device` and configure `canvas` to render
 * it. The scene writes its frame stats into `telemetry` as it draws; the
 * outer `attach` reads those from `__ROWER3D_*` globals the same handles
 * were published under.
 *
 * `canvas` is reused across device swaps (D1-a of #584); the engine
 * reconfigures its `GPUCanvasContext` for the new device each time.
 */
export const createRideScene = async (
  canvas: HTMLCanvasElement,
  device: GPUDevice,
  telemetry: TelemetryHandles,
  opts: RideSceneOpts,
  session: { dispose(): void },
): Promise<RideSceneHandle | null> => {
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

  // Sprout fade uniform (#562 FR6 / D6-b). The window metres are per-tier
  // and read from the DISTANCE tier when the caller split the two axes
  // (#591-fu P2c); falls back to the main tier otherwise.
  const sproutUniforms = createSproutUniformBuffer(device);
  const sproutScratch = new Float32Array(4);
  const sprout = sproutWindowFor(opts.distanceTier ?? opts.tier);
  packSproutUniforms(sprout.near, sprout.far, sproutScratch);
  device.queue.writeBuffer(sproutUniforms, 0, sproutScratch as BufferSource);

  // D7-a of #555: wire the scenery pass unconditionally.
  const sceneryPoolInputs: PoolInput[] = isSceneryRoute(opts.route) ? opts.route.pools : [];
  // Scenery pool telemetry starts fresh on each scene build so a reattach
  // doesn't double-count pools from the dead device.
  telemetry.scenery.pools = [];
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
  interface BoatScullPrimitive {
    id: string;
    nodeWorld: Mat4;
    group?: string;
    pivotWorld?: Mat4;
  }
  const boatScullPrimitives: BoatScullPrimitive[] = [];
  const COURSE_FURNITURE_MODELS: SceneryModelId[] = [
    'a01-buoy-lane-sphere',
    'a06-finish-tower',
    'a07-distance-marker-post',
  ];
  const sceneryGlbList = isSceneryRoute(opts.route) ? opts.route.sceneryGlbs ?? [] : [];
  const COURSE_FURNITURE_MAX_INSTANCES = 1024;
  const tierFolderFor = (id: string): string => {
    const prefix = id[0]?.toLowerCase() ?? 'a';
    const tier = 'abcdefgl'.includes(prefix) ? prefix : 'a';
    return `tier-${tier}`;
  };
  try {
    const crewGlb = opts.crew === 'female' ? 'scull-female.glb' : 'scull-male.glb';
    const res = await fetch(assetUrl(`/assets/boat/${crewGlb}`));
    if (res.ok) {
      const bytes = new Uint8Array(await res.arrayBuffer());
      const model = await loadGlb(bytes, { preserveNodeTransforms: true });
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
        const nodeWorld = mat4();
        if (prim.nodeWorldMatrix) {
          for (let k = 0; k < 16; k += 1) nodeWorld[k] = prim.nodeWorldMatrix[k];
        } else {
          mat4Identity(nodeWorld);
        }
        let pivotWorld: Mat4 | undefined;
        if (prim.pivotWorldMatrix) {
          pivotWorld = mat4();
          for (let k = 0; k < 16; k += 1) pivotWorld[k] = prim.pivotWorldMatrix[k];
        }
        boatScullPrimitives.push({
          id,
          nodeWorld,
          group: prim.groupName,
          pivotWorld,
        });
      }
    }
  } catch { /* scull GLB load failed — the old baked boat remains as fallback */ }

  // Scenery GLBs load lazily as the route progresses (see sceneryStreamPlan):
  // this fetches + registers one model on demand, returning whether it
  // registered. The streaming controller built after placement drives it from
  // the boat's distance, so distant scenery isn't fetched until the boat nears
  // it — no up-front burst that blocks the first frame or trips a host 503.
  const loadSceneryModel = async (id: string): Promise<boolean> => {
    try {
      const url = assetUrl(`/assets/scenery/${tierFolderFor(id)}/${id}.glb`);
      const res = await fetch(url);
      if (!res.ok) return false;
      const bytes = new Uint8Array(await res.arrayBuffer());
      const model = await loadGlb(bytes);
      // Merge the model's primitives, baking each primitive's base colour per
      // vertex so a multi-material model (trunk/leaves, walls/roof/windows)
      // keeps its parts distinct instead of collapsing to primitive-0's colour.
      const merged = mergeSceneryPrimitives(model.primitives);
      // Tier-E is the vegetation/ground-cover kit. Its GLBs carry physically-
      // dark LINEAR albedos that the HDR + ACES composite crushes toward
      // black, so the detailed kit trees read far darker than the procedural
      // flora. Lift them into the same effective range so leaves stay green
      // and trunks brown; buildings (tier-D) are left alone (see
      // VEGETATION_ALBEDO_GAIN).
      const colors =
        tierFolderFor(id) === 'tier-e'
          ? scaleMeshColors(merged.colors, VEGETATION_ALBEDO_GAIN)
          : merged.colors;
      sceneryMeshPass.register({
        id,
        positions: merged.positions,
        normals: merged.normals,
        indices: merged.indices,
        colors,
        baseColor: model.primitives[0]?.baseColor ?? [1, 1, 1, 1],
        maxInstances: COURSE_FURNITURE_MAX_INSTANCES,
      });
      return true;
    } catch {
      // A fetch or decode failure leaves the model unregistered; the pass
      // silently skips it rather than taking the engine down.
      return false;
    }
  };

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
    // #591-fu P1c: tier-gated flora + GLB-scenery shadow casters. Each
    // input stays null below medium so the depth stage adds nothing on
    // basic/low; at medium+ the stage picks up every solid-flora pool
    // and every registered GLB mesh (populated asynchronously as scenery
    // GLBs load) and renders their depth into the cascade atlas.
    floraSolidResources: tierCaps.castFloraShadows ? floraSolidStage.resources : null,
    floraLeafAtlas: tierCaps.castFloraShadows
      ? { view: floraSolidStage.signature.leafAtlasView, sampler: floraSolidStage.signature.leafSampler }
      : null,
    sceneryMeshPass: tierCaps.castSceneryShadows ? sceneryMeshPass : null,
  });

  const shadowResources = {
    uniforms: shadowUniformsBuf,
    atlasView: atlas.view,
    cmpSampler: shadowCmpSampler,
  };
  // Biome-density grass modulation (#496 Phase 2). Default to the route's
  // dominant profile when the adapter supplied one; strength scales with
  // the actual device tier, respecting the `__VIRTUALROW_SHADER_GRASS`
  // kill switch the React scene also honours — see `shaderGrass.ts`.
  const bankGrassProfile = (
    isSceneryRoute(opts.route) ? (opts.route.dominantProfile as SceneryProfile | undefined) : undefined
  ) ?? 'fallback';
  const bankGrassStrength = shaderGrassStrengthFor((opts.tier ?? 'medium') as PerformanceMode);
  const bankPass = createBankPass({
    device,
    format,
    frameUniforms,
    shadow: shadowResources,
    curve: waterCurve,
    edgesForProgress: waterEdgesForProgress,
    grass: { profile: bankGrassProfile, strength: bankGrassStrength },
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
  const cloudsPass = tierCaps.drawClouds
    ? createCloudsPass({ device, format, frameUniforms })
    : null;
  // #574 rain overlay: on only when the tier allows it AND the dev has
  // flipped `window.__VIRTUALROW_RAIN=true` (so a mobile ride isn't
  // soaked by default). Follow-up: wire to real weather data.
  const rainEnabled =
    tierCaps.drawRainOverlay &&
    !!(globalThis as unknown as { window?: { __VIRTUALROW_RAIN?: boolean } }).window
      ?.__VIRTUALROW_RAIN;
  const rainPass = rainEnabled
    ? createRainOverlayPass({ device, format, frameUniforms })
    : null;
  // #571 — hull wake foam. Shared state lives here; the ride loop below
  // calls `updateWake` each frame, and the pass uploads the pool to its
  // storage buffer before drawing.
  const wakeState = createWakeState();
  const wakePass = tierCaps.drawWakeParticles
    ? createWakeParticlesPass({ device, format, frameUniforms, wakeState })
    : null;
  // #571 oar-blade splash: shared CPU state + a billboard pass. The
  // update loop below detects the catch (phase 0) and finish (phase 0.5)
  // crossings and bursts particles at both blade tips.
  const oarSplashState = createOarSplashState();
  const oarSplashPass = tierCaps.drawOarSplash
    ? createOarSplashPass({ device, format, frameUniforms, state: oarSplashState })
    : null;

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
    autoExposure: tierCaps.drawAutoExposure,
    chromaticAberration: tierCaps.drawChromaticAberration,
  };
  const postFx = createPostFx({ device, sceneFormat: format, outputFormat, caps: postCaps });
  postFx.setInputs({
    sceneView: sceneTexture.createView(),
    sceneTexture,
    depthView: depthTexture.createView(),
    width,
    height,
  });

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
    ...(rainPass ? [rainPass] : []),
    ...(wakePass ? [wakePass] : []),
    ...(oarSplashPass ? [oarSplashPass] : []),
    postFx.pass,
  ];
  // #584 AC3: GPU frame-time timer. null on adapters without `timestamp-query`
  // (CI's SwiftShader among them), where gpuMs stays 0 and the frame is
  // unchanged.
  const gpuTimer = createGpuFrameTimer(device);
  const graph: FrameGraph = createFrameGraph(passes, gpuTimer);

  const frame: FrameUniforms = {
    view: mat4Identity(mat4()),
    proj: mat4(),
    viewProj: mat4(),
    camPos: vec3(0, 2.6, 7),
    sunDir: vec3(0.3, 0.8, 0.5),
    fog: new Float32Array([0.001, 0.0005, 0, 0]),
    time: 0,
    // #567 "Animated cloud flow": prevailing wind in UV / second. Slightly
    // livelier than the pre-#567 hard-coded (0.012, 0.004) so the sky reads
    // as a moving overcast rather than a static backdrop. Direction has a
    // small bias so the two components aren't equal — looks like real wind
    // rather than a diagonal sweep.
    wind: new Float32Array([0.018, 0.006]),
  };
  // #596 follow-up: the view-distance axis also shapes the fog curtain, so a
  // wider distance tier reveals the longer sprout window instead of ending in
  // fog, and a narrower one pulls the curtain in. Scales both density terms by
  // one factor; medium/undefined leaves the baseline untouched.
  const fogScale = fogDistanceScaleFor(opts.distanceTier ?? opts.tier);
  frame.fog[0] *= fogScale;
  frame.fog[1] *= fogScale;

  const routeCurve = waterCurve;
  const curveLength = routeCurve.approximateLength(32);
  const totalDistanceMeters =
    isSceneryRoute(opts.route) && typeof opts.route.totalDistanceMeters === 'number'
      ? Math.max(1, opts.route.totalDistanceMeters)
      : Math.max(1, curveLength);
  telemetry.route.hasCurve = true;
  telemetry.route.totalDistance = totalDistanceMeters;
  telemetry.route.curveLength = curveLength;

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
  const ASSET_SCALE = 0.001;
  for (const place of furniture) {
    const trs = mat4();
    const rot = mat4();
    const t = mat4();
    mat4FromRotationY(rot, place.rotationY);
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
  // Combine course-furniture + GLB-scenery instance transforms into one map,
  // keyed by model id. The streaming controller calls `setInstances` for a
  // model only once its GLB has registered.
  const sceneryInstanceMats = new Map<string, Mat4[]>();
  for (const model of COURSE_FURNITURE_MODELS) {
    sceneryInstanceMats.set(model, byModel.get(model) ?? []);
  }
  for (const group of sceneryGlbList) {
    const mats: Mat4[] = [];
    for (const inst of group.instances) {
      const trs = mat4();
      const rot = mat4();
      const t = mat4();
      mat4FromRotationY(rot, inst.rotationY);
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
    sceneryInstanceMats.set(group.id, mats);
  }

  // Progressive loading plan: sample the route for along-route distances, work
  // out where each model first appears, and load models as the boat comes
  // within the look-ahead window (driven from the frame loop below).
  const SCENERY_STREAM_SAMPLES = 128;
  const SCENERY_LOOKAHEAD_M = 400;
  const SCENERY_MAX_PER_TICK = 3;
  const streamSamples: CurveDistanceSample[] = [];
  for (let i = 0; i <= SCENERY_STREAM_SAMPLES; i += 1) {
    const p = i / SCENERY_STREAM_SAMPLES;
    const cp = routeCurve.sample(p);
    streamSamples.push({
      position: [cp.position[0], cp.position[1], cp.position[2]],
      distanceMeters: p * totalDistanceMeters,
    });
  }
  const sceneryPlan = planSceneryStream(
    [...sceneryInstanceMats].map(([id, mats]) => ({
      id,
      instancePositions: mats.map((m) => [m[12], m[13], m[14]] as [number, number, number]),
    })),
    streamSamples,
  );
  const sceneryLoaded = new Set<string>();
  const sceneryLoading = new Set<string>();
  const streamScenery = (boatDistanceMeters: number): void => {
    const pending = sceneryModelsToLoad(
      sceneryPlan,
      new Set<string>([...sceneryLoaded, ...sceneryLoading]),
      boatDistanceMeters,
      SCENERY_LOOKAHEAD_M,
      SCENERY_MAX_PER_TICK,
    );
    for (const id of pending) {
      sceneryLoading.add(id);
      void loadSceneryModel(id)
        .then((ok) => {
          sceneryLoading.delete(id);
          sceneryLoaded.add(id);
          if (ok) sceneryMeshPass.setInstances(id, sceneryInstanceMats.get(id) ?? []);
        })
        .catch(() => {
          sceneryLoading.delete(id);
        });
    }
  };

  const cameraRig = createRigTarget();
  const boatPlacement = createPlacement();
  const ghostPlacement = createPlacement();
  const boatBones = [mat4(), mat4(), mat4(), mat4()];
  const ghostBones = [mat4(), mat4(), mat4(), mat4()];
  for (let i = 0; i < BOAT_BONE_COUNT; i++) {
    mat4Identity(boatBones[i]);
    mat4Identity(ghostBones[i]);
  }
  // #571 shell paint: when the shell plumbs an athlete id through,
  // the hull tint comes from `boatPaint.boatTintFromAthlete`. Falls
  // back to today's off-white when the id is empty / undefined.
  const BOAT_TINT = boatTintFromAthlete(opts.athleteId);
  const GHOST_TINT = new Float32Array([0.35, 0.85, 1.0, 0.5]);

  const start = now();
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

  let lastDistanceMeters = 0;
  let lastSpeedTime = -1;
  // Smooths the boat's distance between the ~2 Hz PM5 samples that drive it so
  // the hull glides instead of holding then jumping at each sample boundary
  // (see distanceSmoother.ts). The ghost is already continuous via
  // `ghostDistanceAt(elapsedSeconds)`; this gives the player boat the same.
  // (#620 replaced the earlier inline smoothedDistance/lastDistSample easing.)
  const distanceSmoother = createDistanceSmoother();
  let lastWakeTime = 0; // #571 — seconds since start, matches `frame.time` units
  let lastOarSplashTime = 0; // #571 — seconds since start, for the oar-splash sim

  const frameOnce = (): void => {
    if (disposed) return;
    // #584 FR3 — cpuMs is the CPU-side encode time. Measured end-to-end so
    // the frame-graph internal work (pass encodes + submit) plus the engine's
    // uniform packs are inside the window. Follow-up: when `timestamp-query`
    // is live, publish gpuMs from the resolved query buffer; today the device
    // asks for the feature (device.ts) but no pass writes a timestamp yet.
    const cpuStart = now();
    resize();
    frame.time = (now() - start) / 1000;

    const rideFrame: RideFrame | null = opts.getFrame ? opts.getFrame() : null;

    const smoothedFrame: RideFrame | null = rideFrame
      ? {
          ...rideFrame,
          distanceMeters: distanceSmoother.update(
            rideFrame.distanceMeters,
            rideFrame.isPlaying && !rideFrame.holdBoat && !rideFrame.finished,
            now(),
          ),
        }
      : null;

    placeBoat(boatPlacement, routeCurve, smoothedFrame, totalDistanceMeters, curveLength, 0);
    // #571 wake foam: run the CPU particle sim before the pass encodes.
    // `isMoving` gates on both `isPlaying` AND the holdBoat/finished state
    // so no spawns happen during countdown or post-finish review.
    const wakeMoving = !!rideFrame?.isPlaying && !rideFrame.holdBoat && !rideFrame.finished;
    const wakeDt = Math.max(0, frame.time - lastWakeTime);
    updateWake(
      wakeState,
      boatPlacement.world[0],
      boatPlacement.world[1],
      boatPlacement.world[2],
      boatPlacement.heading,
      wakeMoving,
      wakeDt,
    );
    lastWakeTime = frame.time;
    // Stream scenery that has come within the look-ahead window as the boat
    // advances; already-loaded / in-flight models are skipped.
    streamScenery(boatPlacement.progress * totalDistanceMeters);
    const ghostInfo = placeGhost(
      ghostPlacement,
      routeCurve,
      rideFrame?.ghost ?? null,
      rideFrame?.elapsedSeconds ?? frame.time,
      totalDistanceMeters,
      curveLength,
      -GHOST_LANE_OFFSET_M,
    );

    const phase = strokePhase(rideFrame?.cadence ?? 0, frame.time, rideFrame?.isPlaying ?? false);
    // #571 oar-blade splash: fire a burst at catch (phase 0 crossing) and
    // finish (phase 0.5 crossing). `isMoving` matches the wake-pass gate.
    const oarSplashMoving = !!rideFrame?.isPlaying && !rideFrame.holdBoat && !rideFrame.finished;
    const oarSplashDt = Math.max(0, frame.time - lastOarSplashTime);
    updateOarSplash(
      oarSplashState,
      boatPlacement.world[0],
      boatPlacement.world[2],
      boatPlacement.heading,
      phase,
      oarSplashMoving,
      oarSplashDt,
    );
    lastOarSplashTime = frame.time;
    const amp = strokeAmplitude(rideFrame);
    const torsoLean = Math.sin(phase * Math.PI * 2) * 0.35 * amp;
    const armPull = Math.sin(phase * Math.PI * 2 + 0.5) * 0.6 * amp;
    const headNod = Math.sin(phase * Math.PI * 2) * 0.1 * amp;
    mat4Identity(boatBones[BOAT_BONE_HULL]);
    mat4FromRotationY(boatBones[BOAT_BONE_TORSO], torsoLean);
    mat4FromRotationY(boatBones[BOAT_BONE_ARMS], armPull);
    mat4FromRotationY(boatBones[BOAT_BONE_HEAD], headNod);
    for (let i = 0; i < BOAT_BONE_COUNT; i++) mat4Identity(ghostBones[i]);

    if (!tierCaps.drawCrew) {
      mat4Identity(boatBones[BOAT_BONE_TORSO]);
      mat4Identity(boatBones[BOAT_BONE_ARMS]);
      mat4Identity(boatBones[BOAT_BONE_HEAD]);
    }
    const scullLoaded = boatScullMeshIds.length > 0;
    boatPass.boatVisible.value = !scullLoaded;
    boatPass.ghostVisible.value = ghostInfo !== null;

    if (scullLoaded) {
      const boatTrs = mat4();
      const scullRot = mat4();
      const scullTrans = mat4();
      mat4FromRotationY(scullRot, boatPlacement.heading);
      mat4Identity(scullTrans);
      scullTrans[12] = boatPlacement.world[0];
      scullTrans[13] = boatPlacement.world[1];
      scullTrans[14] = boatPlacement.world[2];
      mat4Multiply(boatTrs, scullTrans, scullRot);

      const cadence = rideFrame?.cadence ?? 0;
      const elapsed = rideFrame?.elapsedSeconds ?? 0;
      const playing = rideFrame?.isPlaying ?? false;
      const phaseSweep = strokePhase(cadence, elapsed, playing);
      const ampSweep = strokeAmplitude(rideFrame);
      const SWEEP_PEAK_RAD = Math.PI / 4;
      const sweep = Math.sin(phaseSweep * Math.PI * 2) * SWEEP_PEAK_RAD * ampSweep;

      const nodeAfterSwing = mat4();
      const toPivot = mat4();
      const fromPivot = mat4();
      const rotSweep = mat4();
      const tmp = mat4();
      const perInstance = mat4();

      for (const prim of boatScullPrimitives) {
        if (prim.group && prim.pivotWorld) {
          const sign = prim.group === 'RightOar' ? -1 : 1;
          mat4FromRotationY(rotSweep, sweep * sign);

          const px = prim.pivotWorld[12];
          const py = prim.pivotWorld[13];
          const pz = prim.pivotWorld[14];
          mat4Identity(toPivot);
          toPivot[12] = -px;
          toPivot[13] = -py;
          toPivot[14] = -pz;
          mat4Identity(fromPivot);
          fromPivot[12] = px;
          fromPivot[13] = py;
          fromPivot[14] = pz;

          mat4Multiply(tmp, toPivot, prim.nodeWorld);
          mat4Multiply(nodeAfterSwing, rotSweep, tmp);
          mat4Multiply(tmp, fromPivot, nodeAfterSwing);
          mat4Multiply(perInstance, boatTrs, tmp);
        } else {
          mat4Multiply(perInstance, boatTrs, prim.nodeWorld);
        }
        sceneryMeshPass.setInstances(prim.id, [perInstance]);
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

    telemetry.boat.x = boatPlacement.world[0];
    telemetry.boat.y = boatPlacement.world[1];
    telemetry.boat.z = boatPlacement.world[2];
    telemetry.boat.heading = boatPlacement.heading;
    telemetry.boat.distanceMeters = boatPlacement.distanceMeters;
    telemetry.boat.progress = boatPlacement.progress;
    telemetry.boat.holding = !!rideFrame?.holdBoat;
    telemetry.boat.finished = !!rideFrame?.finished;
    telemetry.boat.isPlaying = !!rideFrame?.isPlaying;

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

    const camBoat = vec3(boatPlacement.world[0], boatPlacement.world[1], boatPlacement.world[2]);
    const camTangent = vec3();
    const camSample = routeCurve.sample(boatPlacement.progress);
    camTangent[0] = camSample.tangent[0];
    camTangent[1] = camSample.tangent[1];
    camTangent[2] = camSample.tangent[2];
    cameraTarget(
      {
        boat: camBoat,
        tangent: camTangent,
        velocityMps: speedMps,
        view: rideFrame?.view ?? 'chase',
        bendSign: 0,
      },
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

    const outputView = context.getCurrentTexture().createView();
    const sceneView = sceneTexture.createView();
    const depthView = depthTexture.createView();
    graph.run(device, sceneView, depthView, width, height, frame, outputView);

    telemetry.frameStats.frame += 1;
    telemetry.frameStats.dtMs = 0;
    telemetry.frameStats.cpuMs = now() - cpuStart;
    // #584 AC3: the GPU-side frame time, read back one frame behind by the
    // timer's bracket passes. Stays 0 when the adapter has no `timestamp-query`.
    telemetry.frameStats.gpuMs = gpuTimer?.gpuMs ?? 0;
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
    let trees = 0;
    let meshes = 0;
    for (const p of telemetry.scenery.pools) {
      if (p.kind !== 'foliage') continue;
      trees += p.instanceCount;
      meshes += 1;
    }
    telemetry.foliage.trees = trees;
    telemetry.foliage.meshes = meshes;
    telemetry.foliage.drawn = trees;
    telemetry.camera.x = eye[0];
    telemetry.camera.y = eye[1];
    telemetry.camera.z = eye[2];
    telemetry.camera.lookX = target[0];
    telemetry.camera.lookY = target[1];
    telemetry.camera.lookZ = target[2];
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
      if (disposed) {
        handle.texture.dispose();
        return;
      }
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
      telemetry.textures.atlasKind = 'placeholder';
    });

  return {
    device,
    frameOnce,
    dispose() {
      if (disposed) return;
      disposed = true;
      graph.dispose();
      gpuTimer?.dispose();
      for (const pool of scenePools) pool.dispose();
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
    },
  };
};
