/// <reference types="@webgpu/types" />

/**
 * Instanced static-mesh scenery pass. Owns a registry of GLB-loaded meshes
 * and draws each one as `instances[i]` × its baked local-space vertices.
 * One pipeline, one bind group layout; each registered mesh gets its own
 * per-mesh bind group (base colour uniform + instance storage buffer) and
 * its own vertex + index buffers. Follows the `boat.ts` static-mesh pattern.
 */

import type { FrameContext, Pass } from '../engine/frameGraph';
import type { Mat4 } from '../math/mat4';
import sceneryMeshWgsl from './sceneryMesh.wgsl?raw';

/** One mat4 (16 floats = 64 B) per instance. */
const BYTES_PER_INSTANCE = 64;

export interface SceneryMeshInput {
  /** Stable id so the registry can be queried + instance buffers updated by id. */
  id: string;
  positions: Float32Array; // interleaved vec3
  normals: Float32Array;   // interleaved vec3
  indices: Uint16Array | Uint32Array;
  /** Fallback colour used for every vertex when `colors` is omitted. */
  baseColor: [number, number, number, number];
  /**
   * Per-vertex colour (vec4 each, matching `positions`). glTF splits a model
   * into one primitive per material, so this carries each primitive's own
   * `baseColor` baked per vertex — otherwise the whole mesh would render in a
   * single colour. Omit it for a genuinely single-colour mesh (e.g. one boat
   * primitive); the pass then fills every vertex with `baseColor`.
   */
  colors?: Float32Array;
  /** Upper bound on the per-mesh instance count, so the buffer is allocated once. */
  maxInstances: number;
}

interface RegisteredMesh {
  id: string;
  positionBuffer: GPUBuffer;
  normalBuffer: GPUBuffer;
  colorBuffer: GPUBuffer;
  indexBuffer: GPUBuffer;
  indexFormat: 'uint16' | 'uint32';
  indexCount: number;
  instanceBuffer: GPUBuffer;
  maxInstances: number;
  instanceCount: number;
  bindGroup: GPUBindGroup;
}

export interface SceneryMeshPass extends Pass {
  register(input: SceneryMeshInput): void;
  /** Write `instances.length` mat4s for `id`; clamps to the registered maxInstances. */
  setInstances(id: string, instances: readonly Mat4[]): void;
  readonly meshCount: number;
}

export interface CreateSceneryMeshPassOptions {
  device: GPUDevice;
  format: GPUTextureFormat;
  frameUniforms: GPUBuffer;
}

export const createSceneryMeshPass = ({
  device,
  format,
  frameUniforms,
}: CreateSceneryMeshPassOptions): SceneryMeshPass => {
  const module = device.createShaderModule({ label: 'sceneryMesh', code: sceneryMeshWgsl });
  const pipeline = device.createRenderPipeline({
    label: 'sceneryMesh',
    layout: 'auto',
    vertex: {
      module,
      entryPoint: 'vs_main',
      buffers: [
        { arrayStride: 12, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }] },
        { arrayStride: 12, attributes: [{ shaderLocation: 1, offset: 0, format: 'float32x3' }] },
        { arrayStride: 16, attributes: [{ shaderLocation: 2, offset: 0, format: 'float32x4' }] },
      ],
    },
    fragment: { module, entryPoint: 'fs_main', targets: [{ format }] },
    primitive: { topology: 'triangle-list', cullMode: 'back' },
    depthStencil: { format: 'depth32float', depthWriteEnabled: true, depthCompare: 'less' },
  });

  const frameLayout = pipeline.getBindGroupLayout(0);
  const meshLayout = pipeline.getBindGroupLayout(1);
  const frameBind = device.createBindGroup({
    label: 'sceneryMesh-frame',
    layout: frameLayout,
    entries: [{ binding: 0, resource: { buffer: frameUniforms } }],
  });

  const registry = new Map<string, RegisteredMesh>();
  const scratchInstance = new Float32Array(16);

  const register = (input: SceneryMeshInput): void => {
    if (registry.has(input.id)) return;
    const positionBuffer = device.createBuffer({
      label: `sceneryMesh:${input.id}-pos`,
      size: input.positions.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(positionBuffer, 0, input.positions as BufferSource);
    const normalBuffer = device.createBuffer({
      label: `sceneryMesh:${input.id}-nrm`,
      size: input.normals.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(normalBuffer, 0, input.normals as BufferSource);
    const vertexCount = input.positions.length / 3;
    // Per-vertex colour: use the supplied buffer when it matches the vertex
    // count, otherwise fill every vertex with the single `baseColor`.
    let colors = input.colors;
    if (!colors || colors.length !== vertexCount * 4) {
      colors = new Float32Array(vertexCount * 4);
      const [r, g, b, a] = input.baseColor;
      for (let v = 0; v < vertexCount; v += 1) {
        colors[v * 4] = r;
        colors[v * 4 + 1] = g;
        colors[v * 4 + 2] = b;
        colors[v * 4 + 3] = a;
      }
    }
    const colorBuffer = device.createBuffer({
      label: `sceneryMesh:${input.id}-col`,
      size: Math.max(16, colors.byteLength),
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(colorBuffer, 0, colors as BufferSource);
    const indexBuffer = device.createBuffer({
      label: `sceneryMesh:${input.id}-idx`,
      size: input.indices.byteLength,
      usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(indexBuffer, 0, input.indices as BufferSource);
    const instanceBuffer = device.createBuffer({
      label: `sceneryMesh:${input.id}-inst`,
      size: Math.max(1, input.maxInstances) * BYTES_PER_INSTANCE,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    const bindGroup = device.createBindGroup({
      label: `sceneryMesh:${input.id}-bg`,
      layout: meshLayout,
      entries: [
        { binding: 1, resource: { buffer: instanceBuffer } },
      ],
    });
    registry.set(input.id, {
      id: input.id,
      positionBuffer,
      normalBuffer,
      colorBuffer,
      indexBuffer,
      indexFormat: input.indices instanceof Uint32Array ? 'uint32' : 'uint16',
      indexCount: input.indices.length,
      instanceBuffer,
      maxInstances: Math.max(1, input.maxInstances),
      instanceCount: 0,
      bindGroup,
    });
  };

  const setInstances = (id: string, instances: readonly Mat4[]): void => {
    const mesh = registry.get(id);
    if (!mesh) return;
    const count = Math.min(instances.length, mesh.maxInstances);
    mesh.instanceCount = count;
    for (let i = 0; i < count; i += 1) {
      scratchInstance.set(instances[i], 0);
      device.queue.writeBuffer(mesh.instanceBuffer, i * BYTES_PER_INSTANCE, scratchInstance as BufferSource);
    }
  };

  let disposed = false;
  return {
    name: 'sceneryMesh',
    register,
    setInstances,
    get meshCount() { return registry.size; },
    encode(ctx: FrameContext) {
      if (disposed || registry.size === 0) return;
      let anyVisible = false;
      for (const mesh of registry.values()) {
        if (mesh.instanceCount > 0) { anyVisible = true; break; }
      }
      if (!anyVisible) return;
      const pass = ctx.encoder.beginRenderPass({
        label: 'sceneryMesh',
        colorAttachments: [{ view: ctx.swapView, loadOp: 'load', storeOp: 'store' }],
        depthStencilAttachment: {
          view: ctx.depthView,
          depthLoadOp: 'load',
          depthStoreOp: 'store',
        },
      });
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, frameBind);
      for (const mesh of registry.values()) {
        if (mesh.instanceCount === 0) continue;
        pass.setBindGroup(1, mesh.bindGroup);
        pass.setVertexBuffer(0, mesh.positionBuffer);
        pass.setVertexBuffer(1, mesh.normalBuffer);
        pass.setVertexBuffer(2, mesh.colorBuffer);
        pass.setIndexBuffer(mesh.indexBuffer, mesh.indexFormat);
        pass.drawIndexed(mesh.indexCount, mesh.instanceCount);
      }
      pass.end();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const mesh of registry.values()) {
        mesh.positionBuffer.destroy();
        mesh.normalBuffer.destroy();
        mesh.colorBuffer.destroy();
        mesh.indexBuffer.destroy();
        mesh.instanceBuffer.destroy();
      }
      registry.clear();
    },
  };
};
