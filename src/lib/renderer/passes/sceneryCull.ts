/**
 * Scenery compute-cull pass (#555 FR2). Builds a reusable
 * cull-pipeline wrapper the `SceneryPass` dispatches once per pool. The
 * uniform block carries the frustum planes, camera xz + max distance, and
 * pool-level bounds; the pipeline writes a compact `indices` buffer plus a
 * `drawIndirect` buffer the scenery render pipeline consumes.
 */

/// <reference types="@webgpu/types" />

import type { FrustumPlanes } from '../math/frustum';
import type { InstancePool } from '../plan/instancePools';
import sceneryCullWgsl from './sceneryCull.wgsl?raw';

export const INDIRECT_DRAW_ARGS_SIZE = 20; // 5 * u32

export interface CullDraw {
  indexCount: number;
  baseVertex: number;
  firstIndex: number;
}

export interface SceneryCuller {
  readonly pipeline: GPUComputePipeline;
  readonly bindGroupLayout: GPUBindGroupLayout;
  attach(pool: InstancePool, draw: CullDraw): PoolCullResources;
  dispose(): void;
}

export interface PoolCullResources {
  uniform: GPUBuffer;
  indices: GPUBuffer;
  indirect: GPUBuffer;
  bindGroup: GPUBindGroup;
  pool: InstancePool;
  draw: CullDraw;
  writeUniforms(frameUniforms: CullFrameInput): void;
  dispatch(encoder: GPUCommandEncoder): void;
  dispose(): void;
}

export interface CullFrameInput {
  planes: FrustumPlanes;
  camX: number;
  camY: number;
  camZ: number;
  maxDistance: number;
}

const UNIFORM_FLOATS = 4 /*planes[0]*/ + 4 + 4 + 4 + 4 + 4 /*planes[1..5]*/ + 4 /*camPos*/ + 4 /*bounds*/;
const UNIFORM_WORDS = UNIFORM_FLOATS + 4; // draw.vec4<u32>
const UNIFORM_BYTES = UNIFORM_WORDS * 4;

export const createSceneryCuller = (device: GPUDevice): SceneryCuller => {
  const module = device.createShaderModule({ label: 'sceneryCull', code: sceneryCullWgsl });
  const bindGroupLayout = device.createBindGroupLayout({
    label: 'sceneryCull',
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
    ],
  });
  const pipeline = device.createComputePipeline({
    label: 'sceneryCull',
    layout: device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
    compute: { module, entryPoint: 'cs_main' },
  });

  let disposed = false;

  return {
    pipeline,
    bindGroupLayout,
    attach(pool, draw) {
      const uniform = device.createBuffer({
        label: `cull-uniform:${pool.kind}:${pool.speciesIndex}`,
        size: UNIFORM_BYTES,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
      const indices = device.createBuffer({
        label: `cull-indices:${pool.kind}:${pool.speciesIndex}`,
        size: Math.max(16, pool.instanceCount * 4),
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
      });
      const indirect = device.createBuffer({
        label: `cull-indirect:${pool.kind}:${pool.speciesIndex}`,
        size: INDIRECT_DRAW_ARGS_SIZE,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.INDIRECT | GPUBufferUsage.COPY_DST,
      });
      const bindGroup = device.createBindGroup({
        label: `cull:${pool.kind}:${pool.speciesIndex}`,
        layout: bindGroupLayout,
        entries: [
          { binding: 0, resource: { buffer: uniform } },
          { binding: 1, resource: { buffer: pool.centresBuffer } },
          { binding: 2, resource: { buffer: indices } },
          { binding: 3, resource: { buffer: indirect } },
        ],
      });
      const scratch = new Float32Array(UNIFORM_WORDS);
      const scratchU32 = new Uint32Array(scratch.buffer);
      const resetArgs = new Uint32Array(5);
      let resourceDisposed = false;
      return {
        uniform,
        indices,
        indirect,
        bindGroup,
        pool,
        draw,
        writeUniforms(frame) {
          // 6 planes × 4 floats = 24 floats, then camPos (4), bounds (4), draw (4 u32).
          scratch.set(frame.planes.subarray(0, 24), 0);
          scratch[24] = frame.camX;
          scratch[25] = frame.camY;
          scratch[26] = frame.camZ;
          scratch[27] = frame.maxDistance;
          scratch[28] = pool.bounds.cx;
          scratch[29] = pool.bounds.cy;
          scratch[30] = pool.bounds.cz;
          scratch[31] = pool.bounds.radius;
          scratchU32[32] = draw.indexCount >>> 0;
          scratchU32[33] = draw.baseVertex >>> 0;
          scratchU32[34] = draw.firstIndex >>> 0;
          scratchU32[35] = 0;
          device.queue.writeBuffer(uniform, 0, scratch as BufferSource);
          // Reset the atomic `instanceCount` + keep the fixed args.
          resetArgs[0] = draw.indexCount >>> 0;
          resetArgs[1] = 0;
          resetArgs[2] = draw.firstIndex >>> 0;
          resetArgs[3] = draw.baseVertex >>> 0;
          resetArgs[4] = 0;
          device.queue.writeBuffer(indirect, 0, resetArgs as BufferSource);
        },
        dispatch(encoder) {
          const pass = encoder.beginComputePass({ label: `cull:${pool.kind}:${pool.speciesIndex}` });
          pass.setPipeline(pipeline);
          pass.setBindGroup(0, bindGroup);
          const workgroups = Math.max(1, Math.ceil(pool.instanceCount / 64));
          pass.dispatchWorkgroups(workgroups, 1, 1);
          pass.end();
        },
        dispose() {
          if (resourceDisposed) return;
          resourceDisposed = true;
          uniform.destroy();
          indices.destroy();
          indirect.destroy();
        },
      };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      // Pipeline / bind-group layout are owned by the device.
    },
  };
};
