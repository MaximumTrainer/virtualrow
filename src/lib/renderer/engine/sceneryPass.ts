/**
 * The scenery pass (#555 FR4 / D4-a). Owns every pool's cull resources and
 * draws them in-order between `bank` and `water`. Each frame:
 *
 *   1. Build the frustum planes from the current view-projection.
 *   2. For each pool: write its cull uniforms and dispatch the compute cull.
 *   3. Open one render pass over the swap texture, bind the shared frame
 *      uniform, and emit one `drawIndirect` per pool.
 *   4. Publish per-pool counts to `__ROWER3D_SCENERY` (via the telemetry
 *      bag's `scenery` entry) and roll `__ROWER3D_FOLIAGE` into shape.
 */

/// <reference types="@webgpu/types" />

import { extractFrustum, frustum, type FrustumPlanes } from '../math/frustum';
import type { FrameContext, Pass } from './frameGraph';
import {
  createPoolBindGroup,
  createScenerySignature,
  INSTANCE_INDEX_COUNT,
  type ScenerySignature,
} from '../passes/scenery';
import { createSceneryCuller, type PoolCullResources, type SceneryCuller } from '../passes/sceneryCull';
import type { InstancePool } from '../plan/instancePools';

/** Must match the layer count in `src/lib/scenery/foliageTexture.ts`. */
const FOLIAGE_SHAPES_COUNT = 3;

export interface SceneryTelemetryEntry {
  kind: string;
  speciesIndex: number;
  chunkIndex: number;
  instanceCount: number;
  /**
   * How many survived the last cull. On WebGPU this is read back opportunistically
   * via a copy — not every frame — so a stale value is normal. Default −1 means
   * "not yet reported this session".
   */
  drawn: number;
}

export interface SceneryTelemetry {
  pools: SceneryTelemetryEntry[];
  dispatchCount: number;
  drawCount: number;
  /** How many of the draws this frame were the sprite pass (#562 FR6). */
  spriteDraws: number;
  /** How many of the draws this frame were the solid pass (#562 FR6). */
  solidDraws: number;
  /** Rough triangle count emitted by the solid pass this frame. */
  solidTriangles: number;
}

export interface SceneryPassOptions {
  device: GPUDevice;
  format: GPUTextureFormat;
  frameUniforms: GPUBuffer;
  /**
   * Sprout fade window uniform buffer (#562 FR6 / D6-b). The engine's
   * `attach.ts` creates one at startup and writes per-tier near/far metres.
   */
  sproutUniforms: GPUBuffer;
  pools: InstancePool[];
  /**
   * Maximum distance from the camera at which a pool instance is drawn.
   * The three scene's `useAnimationFrame` cull uses `viewDistance` from the
   * tier's fog plane; the engine defaults to 320 m for P3 which matches the
   * `medium` tier's foliage draw range.
   */
  maxDistance?: number;
  /**
   * Optional telemetry sink. The engine passes the mutable bag from
   * `telemetry.ts`; a null entry means "don't report".
   */
  telemetry?: SceneryTelemetry;
  /**
   * Per-species leaf atlas: a 3-layer `rgba8unorm-srgb` texture whose layers
   * are indexed by the metadata species index (0=broadleaf, 1=conifer,
   * 2=willow). Attach creates it from `paintFoliage` output. Optional so
   * existing unit tests that mount the pass without a texture still work;
   * the pass creates a 1×1 placeholder in that case.
   */
  foliageAtlasView?: GPUTextureView;
  /** Shared sampler for the foliage atlas. */
  foliageSampler?: GPUSampler;
}

export interface SceneryPass extends Pass {
  readonly pools: readonly InstancePool[];
  readonly culler: SceneryCuller;
  readonly signature: ScenerySignature;
  readonly telemetry: SceneryTelemetry;
}

export const DEFAULT_MAX_DISTANCE = 320;

export const createSceneryPass = (opts: SceneryPassOptions): SceneryPass => {
  const { device, format, frameUniforms, sproutUniforms, pools } = opts;
  // 1×1 placeholder atlas so a caller without textures (unit tests) can still
  // mount the pass; attach always supplies the real `paintFoliage` atlas.
  let placeholderTex: GPUTexture | null = null;
  let placeholderSampler: GPUSampler | null = null;
  const foliageAtlasView = opts.foliageAtlasView ?? (() => {
    placeholderTex = device.createTexture({
      label: 'foliage-atlas-placeholder',
      size: { width: 1, height: 1, depthOrArrayLayers: FOLIAGE_SHAPES_COUNT },
      format: 'rgba8unorm-srgb',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    return placeholderTex.createView({ dimension: '2d-array' });
  })();
  const foliageSampler = opts.foliageSampler ?? (() => {
    placeholderSampler = device.createSampler({ label: 'foliage-placeholder' });
    return placeholderSampler;
  })();
  const maxDistance = opts.maxDistance ?? DEFAULT_MAX_DISTANCE;
  const signature = createScenerySignature(device, format);
  const culler = createSceneryCuller(device);
  const telemetry: SceneryTelemetry = opts.telemetry ?? {
    pools: pools.map((p) => ({
      kind: p.kind,
      speciesIndex: p.speciesIndex,
      chunkIndex: p.chunkIndex,
      instanceCount: p.instanceCount,
      drawn: -1,
    })),
    dispatchCount: 0,
    drawCount: 0,
    spriteDraws: 0,
    solidDraws: 0,
    solidTriangles: 0,
  };

  // Pool-side cull + draw resources. One per pool, built once.
  const resources = pools.map((pool) => {
    const cull = culler.attach(pool, {
      indexCount: INSTANCE_INDEX_COUNT,
      baseVertex: 0,
      firstIndex: 0,
    });
    const bindGroup = createPoolBindGroup(device, signature, cull);
    return { pool, cull, bindGroup };
  });

  const frameBindGroup = device.createBindGroup({
    label: 'scenery-frame',
    layout: signature.frameLayout,
    entries: [
      { binding: 0, resource: { buffer: frameUniforms } },
      { binding: 1, resource: { buffer: sproutUniforms } },
      { binding: 2, resource: foliageAtlasView },
      { binding: 3, resource: foliageSampler },
    ],
  });

  const planes: FrustumPlanes = frustum();

  let disposed = false;

  return {
    name: 'scenery',
    pools,
    culler,
    signature,
    telemetry,
    encode(ctx: FrameContext) {
      if (disposed) return;
      if (resources.length === 0) return;

      // 1. Build frustum planes + dispatch the cull for every pool.
      extractFrustum(planes, ctx.frame.viewProj);
      for (const r of resources) {
        r.cull.writeUniforms({
          planes,
          camX: ctx.frame.camPos[0],
          camY: ctx.frame.camPos[1],
          camZ: ctx.frame.camPos[2],
          maxDistance,
        });
        r.cull.dispatch(ctx.encoder);
        telemetry.dispatchCount += 1;
      }

      // 2. One render pass; one drawIndirect per pool.
      const pass = ctx.encoder.beginRenderPass({
        label: 'scenery',
        colorAttachments: [
          { view: ctx.swapView, loadOp: 'load', storeOp: 'store' },
        ],
        depthStencilAttachment: {
          view: ctx.depthView,
          depthLoadOp: 'load',
          depthStoreOp: 'store',
        },
      });
      pass.setPipeline(signature.pipeline);
      pass.setBindGroup(0, frameBindGroup);
      for (const r of resources) {
        pass.setBindGroup(1, r.bindGroup);
        pass.drawIndirect(r.cull.indirect, 0);
        telemetry.drawCount += 1;
        telemetry.spriteDraws += 1;
      }
      pass.end();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const r of resources) {
        r.cull.dispose();
      }
      culler.dispose();
      signature.dispose();
    },
  };
};

/** Export the resource type for the device-spy tests. */
export type { PoolCullResources };
