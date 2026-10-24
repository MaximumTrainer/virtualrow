/**
 * Scenery render pipeline (#555 FR3). One pipeline shared across every pool;
 * each pool gets its own bind group pointing at its centres + the compact
 * `indices` buffer the compute cull wrote.
 *
 * The pass is driven by `engine/sceneryPass.ts`; this file owns the
 * pipeline shape + per-pool draw helper.
 */

/// <reference types="@webgpu/types" />

import type { PoolCullResources } from './sceneryCull';
import sceneryWgsl from './scenery.wgsl?raw';

export interface ScenerySignature {
  module: GPUShaderModule;
  pipeline: GPURenderPipeline;
  frameLayout: GPUBindGroupLayout;
  poolLayout: GPUBindGroupLayout;
  dispose(): void;
}

export const INSTANCE_INDEX_COUNT = 12; // see QUAD_INDICES in scenery.wgsl

export const createScenerySignature = (
  device: GPUDevice,
  format: GPUTextureFormat,
): ScenerySignature => {
  const module = device.createShaderModule({ label: 'scenery', code: sceneryWgsl });
  const frameLayout = device.createBindGroupLayout({
    label: 'scenery-frame',
    entries: [
      { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } },
    ],
  });
  const poolLayout = device.createBindGroupLayout({
    label: 'scenery-pool',
    entries: [
      { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
      { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
    ],
  });
  const pipeline = device.createRenderPipeline({
    label: 'scenery',
    layout: device.createPipelineLayout({ bindGroupLayouts: [frameLayout, poolLayout] }),
    vertex: { module, entryPoint: 'vs_main' },
    fragment: {
      module,
      entryPoint: 'fs_main',
      targets: [
        {
          format,
          // Alpha-blend so the sprout fade (#562 FR6) reads as a soft cross-fade
          // with the solid pool.
          blend: {
            color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
            alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
          },
        },
      ],
    },
    primitive: { topology: 'triangle-list', cullMode: 'none' },
    depthStencil: { depthWriteEnabled: true, depthCompare: 'less', format: 'depth32float' },
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

export const createPoolBindGroup = (
  device: GPUDevice,
  signature: ScenerySignature,
  cull: PoolCullResources,
): GPUBindGroup =>
  device.createBindGroup({
    label: `scenery-pool:${cull.pool.kind}:${cull.pool.speciesIndex}`,
    layout: signature.poolLayout,
    entries: [
      { binding: 0, resource: { buffer: cull.pool.centresBuffer } },
      { binding: 1, resource: { buffer: cull.indices } },
    ],
  });
