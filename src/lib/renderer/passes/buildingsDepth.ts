/**
 * Buildings shadow-depth pipeline (#566 FR4 / D4-a). Mirrors
 * `createSceneryDepthPipeline` — one `drawIndexed`-less draw per cascade,
 * no colour target, depth32float.
 */

/// <reference types="@webgpu/types" />

import buildingsDepthWgsl from './buildingsDepth.wgsl?raw';

export interface BuildingsDepthPipeline {
  pipeline: GPURenderPipeline;
  cascadeLayout: GPUBindGroupLayout;
  poolLayout: GPUBindGroupLayout;
  dispose(): void;
}

export const createBuildingsDepthPipeline = (
  device: GPUDevice,
): BuildingsDepthPipeline => {
  const module = device.createShaderModule({
    label: 'buildingsDepth',
    code: buildingsDepthWgsl,
  });
  const cascadeLayout = device.createBindGroupLayout({
    label: 'buildingsDepth:cascade',
    entries: [
      { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } },
    ],
  });
  const poolLayout = device.createBindGroupLayout({
    label: 'buildingsDepth:pool',
    entries: [
      { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
      { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
    ],
  });
  const pipeline = device.createRenderPipeline({
    label: 'buildingsDepth',
    layout: device.createPipelineLayout({
      bindGroupLayouts: [cascadeLayout, poolLayout],
    }),
    vertex: { module, entryPoint: 'vs_main' },
    fragment: { module, entryPoint: 'fs_main', targets: [] },
    primitive: { topology: 'triangle-list', cullMode: 'back', frontFace: 'ccw' },
    depthStencil: {
      depthWriteEnabled: true,
      depthCompare: 'less',
      format: 'depth32float',
    },
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

export interface BuildingsDepthPool {
  centresBuffer: GPUBuffer;
  sizesBuffer: GPUBuffer;
}

export const createBuildingsDepthPoolBindGroup = (
  device: GPUDevice,
  layout: GPUBindGroupLayout,
  pool: BuildingsDepthPool,
): GPUBindGroup =>
  device.createBindGroup({
    label: 'buildingsDepth:pool',
    layout,
    entries: [
      { binding: 0, resource: { buffer: pool.centresBuffer } },
      { binding: 1, resource: { buffer: pool.sizesBuffer } },
    ],
  });
