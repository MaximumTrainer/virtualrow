/**
 * Solid flora stage (#562 FR4 / FR5). Owns the per-species low-poly solid
 * meshes + their own compute-cull attach (separate indirect from the sprite
 * pass), and draws them after `scenery` in the frame graph. The sprout fade
 * (D6-b) is applied per-vertex in `floraSolid.wgsl`; sprites fade in below
 * `sproutNear`, solids fade out above `sproutFar`.
 */

/// <reference types="@webgpu/types" />

import { extractFrustum, frustum, type FrustumPlanes } from '../math/frustum';
import type { FrameContext, Pass } from './frameGraph';
import {
  createFloraSolidBindGroups,
  createFloraSolidSignature,
  type FloraSolidSignature,
} from '../passes/floraSolid';
import type { SceneryCuller, PoolCullResources } from '../passes/sceneryCull';
import {
  createFloraSolidPool,
  type FloraSolidPoolResources,
} from '../plan/floraSolidPool';
import type { InstancePool, PoolInput } from '../plan/instancePools';
import type { SceneryTelemetry } from './sceneryPass';

export interface FloraSolidStageOptions {
  device: GPUDevice;
  format: GPUTextureFormat;
  frameUniforms: GPUBuffer;
  sproutUniforms: GPUBuffer;
  culler: SceneryCuller;
  /** Original pool inputs: used to rebuild solid meshes per species. */
  poolInputs: readonly PoolInput[];
  /** Matching sprite pools (same order), for sharing the centres buffer. */
  spritePools: readonly InstancePool[];
  maxDistance?: number;
  telemetry: SceneryTelemetry;
}

export interface FloraSolidStage extends Pass {
  readonly signature: FloraSolidSignature;
  readonly resources: readonly FloraSolidPoolResources[];
}

const DEFAULT_MAX_DISTANCE = 320;

export const createFloraSolidStage = (opts: FloraSolidStageOptions): FloraSolidStage => {
  const { device, format, frameUniforms, sproutUniforms, culler, poolInputs, spritePools, telemetry } = opts;
  const maxDistance = opts.maxDistance ?? DEFAULT_MAX_DISTANCE;
  const signature = createFloraSolidSignature(device, format);

  type Entry = {
    resources: FloraSolidPoolResources;
    cull: PoolCullResources;
    bindings: ReturnType<typeof createFloraSolidBindGroups>;
  };
  const entries: Entry[] = [];
  for (let i = 0; i < poolInputs.length; i += 1) {
    const input = poolInputs[i];
    if (input.kind !== 'foliage') continue;
    const resources = createFloraSolidPool(device, {
      speciesIndex: input.speciesIndex,
      positions: input.positions,
      metadata: input.metadata,
      bounds: input.bounds,
    });
    // Separate attach so solid gets its own indirect-args buffer with the
    // mesh's index count. Sprites still cull against their own indirect.
    const cull = culler.attach(resources.pool, {
      indexCount: resources.mesh.indices.length,
      baseVertex: 0,
      firstIndex: 0,
    });
    const bindings = createFloraSolidBindGroups(device, signature, frameUniforms, sproutUniforms, cull);
    entries.push({ resources, cull, bindings });
    // Mirror the sprite pool's telemetry: expose the solid as its own entry.
    telemetry.pools.push({
      kind: 'floraSolid',
      speciesIndex: input.speciesIndex,
      chunkIndex: spritePools[i]?.chunkIndex ?? 0,
      instanceCount: resources.pool.instanceCount,
      drawn: -1,
    });
  }

  const planes: FrustumPlanes = frustum();
  let disposed = false;

  return {
    name: 'floraSolid',
    signature,
    resources: entries.map((e) => e.resources),
    encode(ctx: FrameContext) {
      if (disposed) return;
      if (entries.length === 0) return;

      extractFrustum(planes, ctx.frame.viewProj);
      for (const e of entries) {
        e.cull.writeUniforms({
          planes,
          camX: ctx.frame.camPos[0],
          camY: ctx.frame.camPos[1],
          camZ: ctx.frame.camPos[2],
          maxDistance,
        });
        e.cull.dispatch(ctx.encoder);
        telemetry.dispatchCount += 1;
      }

      const pass = ctx.encoder.beginRenderPass({
        label: 'floraSolid',
        colorAttachments: [{ view: ctx.swapView, loadOp: 'load', storeOp: 'store' }],
        depthStencilAttachment: {
          view: ctx.depthView,
          depthLoadOp: 'load',
          depthStoreOp: 'store',
        },
      });
      pass.setPipeline(signature.pipeline);
      for (const e of entries) {
        pass.setBindGroup(0, e.bindings.frame);
        pass.setBindGroup(1, e.bindings.pool);
        pass.setVertexBuffer(0, e.resources.positionBuffer);
        pass.setVertexBuffer(1, e.resources.normalBuffer);
        pass.setVertexBuffer(2, e.resources.mixBuffer);
        pass.setIndexBuffer(e.resources.indexBuffer, 'uint16');
        pass.drawIndexedIndirect(e.cull.indirect, 0);
        telemetry.drawCount += 1;
        telemetry.solidDraws += 1;
        telemetry.solidTriangles += e.resources.mesh.triangleCount * e.resources.pool.instanceCount;
      }
      pass.end();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const e of entries) {
        e.cull.dispose();
        e.resources.dispose();
      }
      signature.dispose();
    },
  };
};
