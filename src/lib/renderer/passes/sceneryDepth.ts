/**
 * Scenery shadow-depth pipeline (#559 FR4, D7-a). Reuses the scenery
 * pass's compact-index buffers via `drawIndirect`, so one draw per
 * cascade per pool.
 */

/// <reference types="@webgpu/types" />

import sceneryDepthWgsl from './sceneryDepth.wgsl?raw';

export interface SceneryDepthPipeline {
  pipeline: GPURenderPipeline;
  cascadeLayout: GPUBindGroupLayout;
  poolLayout: GPUBindGroupLayout;
  dispose(): void;
}

export const createSceneryDepthPipeline = (
  device: GPUDevice,
): SceneryDepthPipeline => {
  const module = device.createShaderModule({
    label: 'sceneryDepth',
    code: sceneryDepthWgsl,
  });
  const cascadeLayout = device.createBindGroupLayout({
    label: 'sceneryDepth:cascade',
    entries: [
      { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } },
    ],
  });
  const poolLayout = device.createBindGroupLayout({
    label: 'sceneryDepth:pool',
    entries: [
      { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
    ],
  });
  const pipeline = device.createRenderPipeline({
    label: 'sceneryDepth',
    layout: device.createPipelineLayout({
      bindGroupLayouts: [cascadeLayout, poolLayout],
    }),
    vertex: { module, entryPoint: 'vs_main' },
    fragment: { module, entryPoint: 'fs_main', targets: [] },
    primitive: { topology: 'triangle-list', cullMode: 'none' },
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

export interface SceneryDepthPool {
  centresBuffer: GPUBuffer;
  kind: string;
  speciesIndex: number;
}

export const createSceneryDepthPoolBindGroup = (
  device: GPUDevice,
  layout: GPUBindGroupLayout,
  pool: SceneryDepthPool,
): GPUBindGroup =>
  device.createBindGroup({
    label: `sceneryDepth:${pool.kind}:${pool.speciesIndex}`,
    layout,
    entries: [
      { binding: 0, resource: { buffer: pool.centresBuffer } },
    ],
  });
