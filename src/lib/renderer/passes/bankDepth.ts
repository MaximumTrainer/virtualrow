/**
 * Bank shadow-depth pipeline (#559 FR4). Depth-only; one draw per
 * cascade over the same bank strips the lit `bank` pass draws.
 */

/// <reference types="@webgpu/types" />

import { buildBankStrips } from '../plan/bankStrip';
import bankDepthWgsl from './bankDepth.wgsl?raw';

export interface BankDepthPipeline {
  pipeline: GPURenderPipeline;
  cascadeLayout: GPUBindGroupLayout;
  positions: GPUBuffer;
  sides: GPUBuffer;
  indices: GPUBuffer;
  indexCount: number;
  dispose(): void;
}

export const createBankDepthPipeline = (
  device: GPUDevice,
): BankDepthPipeline => {
  const module = device.createShaderModule({ label: 'bankDepth', code: bankDepthWgsl });
  const cascadeLayout = device.createBindGroupLayout({
    label: 'bankDepth:cascade',
    entries: [
      { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } },
    ],
  });
  const pipeline = device.createRenderPipeline({
    label: 'bankDepth',
    layout: device.createPipelineLayout({ bindGroupLayouts: [cascadeLayout] }),
    vertex: {
      module,
      entryPoint: 'vs_main',
      buffers: [
        { arrayStride: 12, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }] },
        { arrayStride: 4, attributes: [{ shaderLocation: 1, offset: 0, format: 'float32' }] },
      ],
    },
    primitive: { topology: 'triangle-list', cullMode: 'none' },
    depthStencil: { depthWriteEnabled: true, depthCompare: 'less', format: 'depth32float' },
  });
  const geom = buildBankStrips();
  const positions = device.createBuffer({
    label: 'bankDepth-pos',
    size: geom.positions.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(positions, 0, geom.positions as BufferSource);
  const sides = device.createBuffer({
    label: 'bankDepth-side',
    size: geom.sides.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(sides, 0, geom.sides as BufferSource);
  const indices = device.createBuffer({
    label: 'bankDepth-idx',
    size: geom.indices.byteLength,
    usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(indices, 0, geom.indices as BufferSource);

  let disposed = false;
  return {
    pipeline,
    cascadeLayout,
    positions,
    sides,
    indices,
    indexCount: geom.indices.length,
    dispose() {
      if (disposed) return;
      disposed = true;
      positions.destroy();
      sides.destroy();
      indices.destroy();
    },
  };
};
