/**
 * Characters depth pipeline (#570 FR8 / D7). Writes boat + crew into one
 * atlas cascade per draw. Called from `shadowStage.ts` only when the tier
 * casts character shadows (`medium+`).
 */

/// <reference types="@webgpu/types" />

import type { BoatMeshBuffers } from '../plan/boatMesh';
import { BOAT_FLOATS_PER_VERTEX } from '../plan/boatMesh';
import charactersDepthWgsl from './charactersDepth.wgsl?raw';

const VERTEX_STRIDE_BYTES = BOAT_FLOATS_PER_VERTEX * 4;

export interface CharactersDepthPipeline {
  pipeline: GPURenderPipeline;
  cascadeLayout: GPUBindGroupLayout;
  drawLayout: GPUBindGroupLayout;
  positions: GPUBuffer;
  indices: GPUBuffer;
  indexCount: number;
  dispose(): void;
}

export const createCharactersDepthPipeline = (
  device: GPUDevice,
  mesh: BoatMeshBuffers,
): CharactersDepthPipeline => {
  const module = device.createShaderModule({
    label: 'charactersDepth',
    code: charactersDepthWgsl,
  });
  const pipeline = device.createRenderPipeline({
    label: 'charactersDepth',
    layout: 'auto',
    vertex: {
      module,
      entryPoint: 'vs_main',
      buffers: [
        {
          arrayStride: VERTEX_STRIDE_BYTES,
          attributes: [
            { shaderLocation: 0, offset: 0, format: 'float32x3' },
            { shaderLocation: 1, offset: 12, format: 'float32x3' },
            { shaderLocation: 2, offset: 24, format: 'float32' },
            { shaderLocation: 3, offset: 28, format: 'float32' },
          ],
        },
      ],
    },
    primitive: { topology: 'triangle-list', cullMode: 'back', frontFace: 'ccw' },
    depthStencil: { depthWriteEnabled: true, depthCompare: 'less', format: 'depth32float' },
  });

  const positions = device.createBuffer({
    label: 'charactersDepth-verts',
    size: mesh.vertices.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(positions, 0, mesh.vertices.buffer, mesh.vertices.byteOffset, mesh.vertices.byteLength);

  const indices = device.createBuffer({
    label: 'charactersDepth-indices',
    size: mesh.indices.byteLength,
    usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(indices, 0, mesh.indices.buffer, mesh.indices.byteOffset, mesh.indices.byteLength);

  let disposed = false;
  return {
    pipeline,
    cascadeLayout: pipeline.getBindGroupLayout(0),
    drawLayout: pipeline.getBindGroupLayout(1),
    positions,
    indices,
    indexCount: mesh.indexCount,
    dispose() {
      if (disposed) return;
      disposed = true;
      positions.destroy();
      indices.destroy();
    },
  };
};
