/**
 * Solid-flora shadow-depth pipeline (#591-fu P1c). Mirrors the lit
 * `floraSolid` pass but renders depth-only into a cascade of the shadow
 * atlas. Alpha-respecting via the shared leaf atlas so a tree's shadow
 * carries the leaf silhouette rather than a solid pyramid.
 *
 * One `drawIndexed` per pool per cascade. Reuses the lit pass's position
 * + mix vertex buffers and the pool's centres storage buffer — no
 * duplicate uploads. The leaf atlas is passed in once (shared with the
 * lit pass) when the pipeline's cascade bind groups are built.
 */

/// <reference types="@webgpu/types" />

import floraSolidDepthWgsl from './floraSolidDepth.wgsl?raw';

export interface FloraSolidDepthPipeline {
  pipeline: GPURenderPipeline;
  cascadeLayout: GPUBindGroupLayout;
  poolLayout: GPUBindGroupLayout;
  dispose(): void;
}

export const createFloraSolidDepthPipeline = (
  device: GPUDevice,
): FloraSolidDepthPipeline => {
  const module = device.createShaderModule({
    label: 'floraSolidDepth',
    code: floraSolidDepthWgsl,
  });
  const cascadeLayout = device.createBindGroupLayout({
    label: 'floraSolidDepth:cascade',
    entries: [
      { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
      { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
    ],
  });
  const poolLayout = device.createBindGroupLayout({
    label: 'floraSolidDepth:pool',
    entries: [
      { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
    ],
  });
  const pipeline = device.createRenderPipeline({
    label: 'floraSolidDepth',
    layout: device.createPipelineLayout({ bindGroupLayouts: [cascadeLayout, poolLayout] }),
    vertex: {
      module,
      entryPoint: 'vs_main',
      buffers: [
        // Position at shaderLocation 0 — same xyz buffer the lit pass uses.
        { arrayStride: 12, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }] },
        // mix at shaderLocation 1 — same mixBuffer the lit pass uses.
        // (The lit pass has it at location 2 behind `normal` at 1; the depth
        // pass skips the normal attribute, so this one slot binds directly.)
        { arrayStride: 8, attributes: [{ shaderLocation: 1, offset: 0, format: 'float32x2' }] },
      ],
    },
    fragment: { module, entryPoint: 'fs_main', targets: [] },
    primitive: { topology: 'triangle-list', cullMode: 'back' },
    depthStencil: { depthWriteEnabled: true, depthCompare: 'less', format: 'depth32float' },
  });
  let disposed = false;
  return {
    pipeline,
    cascadeLayout,
    poolLayout,
    dispose() {
      if (disposed) return;
      disposed = true;
    },
  };
};

export const createFloraSolidDepthPoolBindGroup = (
  device: GPUDevice,
  layout: GPUBindGroupLayout,
  centresBuffer: GPUBuffer,
  label = 'floraSolidDepth:pool',
): GPUBindGroup =>
  device.createBindGroup({
    label,
    layout,
    entries: [{ binding: 0, resource: { buffer: centresBuffer } }],
  });

export const createFloraSolidDepthCascadeBindGroup = (
  device: GPUDevice,
  layout: GPUBindGroupLayout,
  cascadeUniforms: GPUBuffer,
  leafAtlasView: GPUTextureView,
  leafSampler: GPUSampler,
  label = 'floraSolidDepth:cascade',
): GPUBindGroup =>
  device.createBindGroup({
    label,
    layout,
    entries: [
      { binding: 0, resource: { buffer: cascadeUniforms } },
      { binding: 1, resource: leafAtlasView },
      { binding: 2, resource: leafSampler },
    ],
  });
