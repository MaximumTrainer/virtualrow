/**
 * Solid flora render pipeline (#562 FR5 / FR6). Shares the P3 scenery
 * compute-cull's compact-indices buffer per pool, but owns its own render
 * pipeline + indirect-args buffer so the two draw lists don't collide.
 *
 * One `drawIndirect` per solid pool. The sprout fade is a per-vertex
 * attenuation: solids fade out above `sproutFar` (see `floraSolid.wgsl`),
 * sprites fade out below `sproutNear` (see the fade in `scenery.wgsl`).
 */

/// <reference types="@webgpu/types" />

import type { FloraSolidPoolResources } from '../plan/floraSolidPool';
import type { PoolCullResources } from './sceneryCull';
import floraSolidWgsl from './floraSolid.wgsl?raw';

export interface FloraSolidSignature {
  module: GPUShaderModule;
  pipeline: GPURenderPipeline;
  frameLayout: GPUBindGroupLayout;
  poolLayout: GPUBindGroupLayout;
  dispose(): void;
}

export const createFloraSolidSignature = (
  device: GPUDevice,
  format: GPUTextureFormat,
): FloraSolidSignature => {
  const module = device.createShaderModule({ label: 'floraSolid', code: floraSolidWgsl });
  const frameLayout = device.createBindGroupLayout({
    label: 'floraSolid-frame',
    entries: [
      { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } },
    ],
  });
  const poolLayout = device.createBindGroupLayout({
    label: 'floraSolid-pool',
    entries: [
      { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
      { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
    ],
  });
  const pipeline = device.createRenderPipeline({
    label: 'floraSolid',
    layout: device.createPipelineLayout({ bindGroupLayouts: [frameLayout, poolLayout] }),
    vertex: {
      module,
      entryPoint: 'vs_main',
      buffers: [
        { arrayStride: 12, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }] },
        { arrayStride: 12, attributes: [{ shaderLocation: 1, offset: 0, format: 'float32x3' }] },
        { arrayStride: 8, attributes: [{ shaderLocation: 2, offset: 0, format: 'float32x2' }] },
      ],
    },
    fragment: {
      module,
      entryPoint: 'fs_main',
      targets: [
        {
          format,
          // Soft fade: alpha-blend over the pool below so the handoff reads
          // as a cross-fade with the sprite pool.
          blend: {
            color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
            alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
          },
        },
      ],
    },
    primitive: { topology: 'triangle-list', cullMode: 'back' },
    depthStencil: { depthWriteEnabled: true, depthCompare: 'less', format: 'depth24plus' },
  });
  let disposed = false;
  return {
    module,
    pipeline,
    frameLayout,
    poolLayout,
    dispose() {
      if (disposed) return;
      disposed = true;
    },
  };
};

export interface FloraSolidBindings {
  frame: GPUBindGroup;
  pool: GPUBindGroup;
}

export const createFloraSolidBindGroups = (
  device: GPUDevice,
  signature: FloraSolidSignature,
  frameUniforms: GPUBuffer,
  sproutUniforms: GPUBuffer,
  cull: PoolCullResources,
): FloraSolidBindings => ({
  frame: device.createBindGroup({
    label: 'floraSolid-frame',
    layout: signature.frameLayout,
    entries: [
      { binding: 0, resource: { buffer: frameUniforms } },
      { binding: 1, resource: { buffer: sproutUniforms } },
    ],
  }),
  pool: device.createBindGroup({
    label: `floraSolid-pool:${cull.pool.speciesIndex}`,
    layout: signature.poolLayout,
    entries: [
      { binding: 0, resource: { buffer: cull.pool.centresBuffer } },
      { binding: 1, resource: { buffer: cull.indices } },
    ],
  }),
});

export interface FloraSolidDrawable {
  resources: FloraSolidPoolResources;
  cull: PoolCullResources;
  bindings: FloraSolidBindings;
}
