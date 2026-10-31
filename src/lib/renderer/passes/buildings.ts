/**
 * Buildings render pass (#566 FR1-FR4). One pipeline, one draw per route:
 * the vertex shader synthesises the prism from `vertex_index` so no vertex
 * buffer binding is needed. The pool's centres + sizes buffers are read
 * as storage. Receives CSM via the shared `sampleShadow` snippet so a
 * `@group(1)` shadow bind group is required.
 */

/// <reference types="@webgpu/types" />

import type { FrameContext, Pass } from '../engine/frameGraph';
import { SAMPLE_SHADOW_WGSL, SHADOW_UNIFORMS_WGSL } from '../engine/shaderSnippets';
import type { ShadowResources } from './bank';
import type { BuildingPool } from '../plan/buildings';
import { BUILDING_ATLAS_SIZE, paintBuildingAtlas } from '../../scenery/buildingAtlas';
import buildingsWgsl from './buildings.wgsl?raw';

/**
 * 48 vertices per instance: 36 for the box prism (six faces × two tris ×
 * three verts) + 12 for the pyramid roof (four triangle slopes × three verts).
 * Changed in #591-fu P0a; was 36 pre-pitched-roof.
 */
export const BUILDINGS_VERTEX_COUNT = 48;

export interface BuildingsPassOptions {
  device: GPUDevice;
  format: GPUTextureFormat;
  frameUniforms: GPUBuffer;
  shadow: ShadowResources;
  pool: BuildingPool | null;
  /**
   * Telemetry sink — the engine writes `__ROWER3D_BUILDINGS` through the
   * same mutable bag the other passes use.
   */
  telemetry: { drawn: number; pool: number; triangles: number };
}

export interface BuildingsPass extends Pass {
  readonly pool: BuildingPool | null;
}

export const createBuildingsPass = (opts: BuildingsPassOptions): BuildingsPass => {
  const { device, format, frameUniforms, shadow, pool, telemetry } = opts;
  const code = SHADOW_UNIFORMS_WGSL + SAMPLE_SHADOW_WGSL + buildingsWgsl;
  const module = device.createShaderModule({ label: 'buildings', code });
  const pipeline = device.createRenderPipeline({
    label: 'buildings',
    layout: 'auto',
    vertex: { module, entryPoint: 'vs_main' },
    fragment: { module, entryPoint: 'fs_main', targets: [{ format }] },
    primitive: { topology: 'triangle-list', cullMode: 'back', frontFace: 'ccw' },
    depthStencil: {
      depthWriteEnabled: true,
      depthCompare: 'less',
      format: 'depth32float',
    },
  });
  const frameBindGroup = device.createBindGroup({
    label: 'buildings-frame',
    layout: pipeline.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: { buffer: frameUniforms } }],
  });
  const shadowBindGroup = device.createBindGroup({
    label: 'buildings-shadow',
    layout: pipeline.getBindGroupLayout(1),
    entries: [
      { binding: 0, resource: { buffer: shadow.uniforms } },
      { binding: 1, resource: shadow.atlasView },
      { binding: 2, resource: shadow.cmpSampler },
    ],
  });
  // #591-fu P0a: shared albedo atlas (brick wall + roof tile) uploaded once
  // per pass. The texture is tiny (`BUILDING_ATLAS_SIZE` square, rgba8unorm-
  // srgb, under 64 KB) and the shader samples with `addressModeU/V = repeat`
  // so one atlas covers every building.
  const atlasPixels = paintBuildingAtlas();
  const atlasTexture = device.createTexture({
    label: 'buildings-atlas',
    size: { width: BUILDING_ATLAS_SIZE, height: BUILDING_ATLAS_SIZE },
    format: 'rgba8unorm-srgb',
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  });
  device.queue.writeTexture(
    { texture: atlasTexture },
    atlasPixels as BufferSource,
    { bytesPerRow: BUILDING_ATLAS_SIZE * 4, rowsPerImage: BUILDING_ATLAS_SIZE },
    { width: BUILDING_ATLAS_SIZE, height: BUILDING_ATLAS_SIZE },
  );
  const atlasSampler = device.createSampler({
    label: 'buildings-atlas-sampler',
    magFilter: 'linear',
    minFilter: 'linear',
    addressModeU: 'repeat',
    addressModeV: 'repeat',
  });

  const poolBindGroup = pool
    ? device.createBindGroup({
        label: 'buildings-pool',
        layout: pipeline.getBindGroupLayout(2),
        entries: [
          { binding: 0, resource: { buffer: pool.centresBuffer } },
          { binding: 1, resource: { buffer: pool.sizesBuffer } },
          { binding: 2, resource: atlasTexture.createView() },
          { binding: 3, resource: atlasSampler },
        ],
      })
    : null;

  let disposed = false;
  return {
    name: 'buildings',
    pool,
    encode(ctx: FrameContext) {
      if (disposed) return;
      if (!pool || !poolBindGroup || pool.instanceCount === 0) return;
      const pass = ctx.encoder.beginRenderPass({
        label: 'buildings',
        colorAttachments: [{ view: ctx.swapView, loadOp: 'load', storeOp: 'store' }],
        depthStencilAttachment: {
          view: ctx.depthView,
          depthLoadOp: 'load',
          depthStoreOp: 'store',
        },
      });
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, frameBindGroup);
      pass.setBindGroup(1, shadowBindGroup);
      pass.setBindGroup(2, poolBindGroup);
      pass.draw(BUILDINGS_VERTEX_COUNT, pool.instanceCount, 0, 0);
      pass.end();
      telemetry.drawn = pool.instanceCount;
      telemetry.pool = pool.instanceCount;
      telemetry.triangles = (BUILDINGS_VERTEX_COUNT / 3) * pool.instanceCount;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      atlasTexture.destroy();
    },
  };
};
