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
import { LEAF_ATLAS_SIZE, paintLeafAtlas } from '../../scenery/leafAtlas';
import floraSolidWgsl from './floraSolid.wgsl?raw';

export interface FloraSolidSignature {
  module: GPUShaderModule;
  pipeline: GPURenderPipeline;
  frameLayout: GPUBindGroupLayout;
  poolLayout: GPUBindGroupLayout;
  /** Leaf atlas texture — one per signature, shared across every pool. */
  leafAtlasView: GPUTextureView;
  /** Sampler used by the fragment shader on `leafAtlasView`. */
  leafSampler: GPUSampler;
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
      { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
      { binding: 3, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
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
    depthStencil: { depthWriteEnabled: true, depthCompare: 'less', format: 'depth32float' },
  });
  // #591-fu P1a: leaf atlas uploaded once per signature. 128×128 rgba8unorm-
  // srgb, under 64 KB. Fragment multiplies the sampled texel into the
  // per-species crown palette so trees read as leafy, not flat cones.
  const leafPixels = paintLeafAtlas();
  const leafTexture = device.createTexture({
    label: 'floraSolid-leaf-atlas',
    size: { width: LEAF_ATLAS_SIZE, height: LEAF_ATLAS_SIZE },
    format: 'rgba8unorm-srgb',
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  });
  device.queue.writeTexture(
    { texture: leafTexture },
    leafPixels as BufferSource,
    { bytesPerRow: LEAF_ATLAS_SIZE * 4, rowsPerImage: LEAF_ATLAS_SIZE },
    { width: LEAF_ATLAS_SIZE, height: LEAF_ATLAS_SIZE },
  );
  const leafSampler = device.createSampler({
    label: 'floraSolid-leaf-sampler',
    magFilter: 'linear',
    minFilter: 'linear',
    addressModeU: 'repeat',
    addressModeV: 'repeat',
  });

  let disposed = false;
  return {
    module,
    pipeline,
    frameLayout,
    poolLayout,
    leafAtlasView: leafTexture.createView(),
    leafSampler,
    dispose() {
      if (disposed) return;
      disposed = true;
      leafTexture.destroy();
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
      { binding: 2, resource: signature.leafAtlasView },
      { binding: 3, resource: signature.leafSampler },
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
