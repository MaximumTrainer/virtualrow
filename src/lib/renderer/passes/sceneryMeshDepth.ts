/**
 * GLB-kit scenery shadow-depth pipeline (#591-fu P1c). Mirrors the lit
 * `sceneryMesh` pass but depth-only. One draw per registered mesh per
 * cascade; borrows the position + index + per-mesh instance buffers from
 * the lit `SceneryMeshPass` via `forEachActiveMesh`.
 */

/// <reference types="@webgpu/types" />

import sceneryMeshDepthWgsl from './sceneryMeshDepth.wgsl?raw';

export interface SceneryMeshDepthPipeline {
  pipeline: GPURenderPipeline;
  cascadeLayout: GPUBindGroupLayout;
  meshLayout: GPUBindGroupLayout;
  dispose(): void;
}

export const createSceneryMeshDepthPipeline = (
  device: GPUDevice,
): SceneryMeshDepthPipeline => {
  const module = device.createShaderModule({
    label: 'sceneryMeshDepth',
    code: sceneryMeshDepthWgsl,
  });
  const cascadeLayout = device.createBindGroupLayout({
    label: 'sceneryMeshDepth:cascade',
    entries: [
      { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } },
    ],
  });
  const meshLayout = device.createBindGroupLayout({
    label: 'sceneryMeshDepth:mesh',
    entries: [
      { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
    ],
  });
  const pipeline = device.createRenderPipeline({
    label: 'sceneryMeshDepth',
    layout: device.createPipelineLayout({ bindGroupLayouts: [cascadeLayout, meshLayout] }),
    vertex: {
      module,
      entryPoint: 'vs_main',
      buffers: [
        // Only position (shaderLocation 0) — same xyz buffer the lit pass uses.
        { arrayStride: 12, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }] },
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
    meshLayout,
    dispose() {
      if (disposed) return;
      disposed = true;
    },
  };
};

export const createSceneryMeshDepthCascadeBindGroup = (
  device: GPUDevice,
  layout: GPUBindGroupLayout,
  cascadeUniforms: GPUBuffer,
  label = 'sceneryMeshDepth:cascade',
): GPUBindGroup =>
  device.createBindGroup({
    label,
    layout,
    entries: [{ binding: 0, resource: { buffer: cascadeUniforms } }],
  });

export const createSceneryMeshDepthMeshBindGroup = (
  device: GPUDevice,
  layout: GPUBindGroupLayout,
  instanceBuffer: GPUBuffer,
  label = 'sceneryMeshDepth:mesh',
): GPUBindGroup =>
  device.createBindGroup({
    label,
    layout,
    entries: [{ binding: 0, resource: { buffer: instanceBuffer } }],
  });
