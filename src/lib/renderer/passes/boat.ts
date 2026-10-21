/**
 * Boat + ghost render pass (#570 FR1-FR3, D1 fallback). One pipeline with
 * two draws per frame: the player's boat and (optionally) the ghost. Each
 * draw rebinds a tiny `BoatUniforms` + `BoatSkin` bind group so the two
 * instances can diverge in model matrix, tint and alpha.
 */

/// <reference types="@webgpu/types" />

import type { FrameContext, Pass } from '../engine/frameGraph';
import type { Mat4 } from '../math/mat4';
import type { BoatMeshBuffers } from '../plan/boatMesh';
import { BOAT_FLOATS_PER_VERTEX, BOAT_BONE_COUNT } from '../plan/boatMesh';
import boatWgsl from './boat.wgsl?raw';

const BOAT_UNIFORM_BYTES = 16 * 4 + 4 * 4 + 4 * 4; // model + tint + flags
const BOAT_SKIN_BYTES = BOAT_BONE_COUNT * 16 * 4;
const VERTEX_STRIDE_BYTES = BOAT_FLOATS_PER_VERTEX * 4;

export interface BoatDrawInputs {
  model: Mat4;
  bones: Mat4[]; // length BOAT_BONE_COUNT
  tintRGBA: Float32Array; // length 4
  ghost: boolean;
  visible: boolean;
}

export interface BoatInstance {
  uniforms: GPUBuffer;
  skin: GPUBuffer;
  bindGroup: GPUBindGroup;
  write(device: GPUDevice, inputs: BoatDrawInputs): void;
  dispose(): void;
}

export interface BoatPass extends Pass {
  readonly boat: BoatInstance;
  readonly ghost: BoatInstance;
  readonly mesh: BoatMeshBuffers;
  readonly indexCount: number;
  readonly boatVisible: { value: boolean };
  readonly ghostVisible: { value: boolean };
}

export interface BoatPassOptions {
  device: GPUDevice;
  format: GPUTextureFormat;
  frameUniforms: GPUBuffer;
  mesh: BoatMeshBuffers;
}

const uniformScratch = new Float32Array(BOAT_UNIFORM_BYTES / 4);
const skinScratch = new Float32Array(BOAT_SKIN_BYTES / 4);

const writeBoatUniforms = (
  buf: GPUBuffer,
  device: GPUDevice,
  inputs: BoatDrawInputs,
): void => {
  uniformScratch.set(inputs.model, 0);
  uniformScratch[16] = inputs.tintRGBA[0];
  uniformScratch[17] = inputs.tintRGBA[1];
  uniformScratch[18] = inputs.tintRGBA[2];
  uniformScratch[19] = inputs.tintRGBA[3];
  uniformScratch[20] = inputs.ghost ? 1 : 0;
  uniformScratch[21] = 0;
  uniformScratch[22] = 0;
  uniformScratch[23] = 0;
  device.queue.writeBuffer(buf, 0, uniformScratch as BufferSource);
};

const writeBoatSkin = (
  buf: GPUBuffer,
  device: GPUDevice,
  bones: Mat4[],
): void => {
  for (let i = 0; i < BOAT_BONE_COUNT; i++) {
    const src = bones[i];
    skinScratch.set(src, i * 16);
  }
  device.queue.writeBuffer(buf, 0, skinScratch as BufferSource);
};

const makeInstance = (
  device: GPUDevice,
  layout: GPUBindGroupLayout,
  label: string,
): BoatInstance => {
  const uniforms = device.createBuffer({
    label: `${label}-uniforms`,
    size: BOAT_UNIFORM_BYTES,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const skin = device.createBuffer({
    label: `${label}-skin`,
    size: BOAT_SKIN_BYTES,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const bindGroup = device.createBindGroup({
    label: `${label}-bg`,
    layout,
    entries: [
      { binding: 0, resource: { buffer: uniforms } },
      { binding: 1, resource: { buffer: skin } },
    ],
  });
  let disposed = false;
  return {
    uniforms,
    skin,
    bindGroup,
    write(device, inputs) {
      if (disposed) return;
      writeBoatUniforms(uniforms, device, inputs);
      writeBoatSkin(skin, device, inputs.bones);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      uniforms.destroy();
      skin.destroy();
    },
  };
};

export const createBoatPass = (opts: BoatPassOptions): BoatPass => {
  const { device, format, frameUniforms, mesh } = opts;
  const module = device.createShaderModule({ label: 'boat', code: boatWgsl });
  const pipeline = device.createRenderPipeline({
    label: 'boat',
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
    fragment: {
      module,
      entryPoint: 'fs_main',
      targets: [
        {
          format,
          blend: {
            color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
            alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
          },
        },
      ],
    },
    primitive: { topology: 'triangle-list', cullMode: 'back', frontFace: 'ccw' },
    depthStencil: { depthWriteEnabled: true, depthCompare: 'less', format: 'depth24plus' },
  });

  const frameBindGroup = device.createBindGroup({
    label: 'boat-frame',
    layout: pipeline.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: { buffer: frameUniforms } }],
  });

  const vertexBuffer = device.createBuffer({
    label: 'boat-verts',
    size: mesh.vertices.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(vertexBuffer, 0, mesh.vertices.buffer, mesh.vertices.byteOffset, mesh.vertices.byteLength);

  const indexBuffer = device.createBuffer({
    label: 'boat-indices',
    size: mesh.indices.byteLength,
    usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(indexBuffer, 0, mesh.indices.buffer, mesh.indices.byteOffset, mesh.indices.byteLength);

  const perDrawLayout = pipeline.getBindGroupLayout(2);
  const boat = makeInstance(device, perDrawLayout, 'boat');
  const ghost = makeInstance(device, perDrawLayout, 'ghost');
  const boatVisible = { value: true };
  const ghostVisible = { value: false };

  let disposed = false;
  return {
    name: 'boat',
    boat,
    ghost,
    mesh,
    indexCount: mesh.indexCount,
    boatVisible,
    ghostVisible,
    encode(ctx: FrameContext) {
      if (disposed) return;
      const pass = ctx.encoder.beginRenderPass({
        label: 'boat',
        colorAttachments: [{ view: ctx.swapView, loadOp: 'load', storeOp: 'store' }],
        depthStencilAttachment: {
          view: ctx.depthView,
          depthLoadOp: 'load',
          depthStoreOp: 'store',
        },
      });
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, frameBindGroup);
      pass.setVertexBuffer(0, vertexBuffer);
      pass.setIndexBuffer(indexBuffer, 'uint16');
      if (boatVisible.value) {
        pass.setBindGroup(2, boat.bindGroup);
        pass.drawIndexed(mesh.indexCount);
      }
      if (ghostVisible.value) {
        pass.setBindGroup(2, ghost.bindGroup);
        pass.drawIndexed(mesh.indexCount);
      }
      pass.end();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      boat.dispose();
      ghost.dispose();
      vertexBuffer.destroy();
      indexBuffer.destroy();
    },
  };
};
