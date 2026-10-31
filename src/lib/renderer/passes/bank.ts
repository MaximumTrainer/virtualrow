/// <reference types="@webgpu/types" />

import type { FrameContext, Pass } from '../engine/frameGraph';
import type { RouteCurve } from '../math/curve';
import { SAMPLE_SHADOW_WGSL, SHADOW_UNIFORMS_WGSL } from '../engine/shaderSnippets';
import { buildBankStrips } from '../plan/bankStrip';
import type { WaterEdges } from '../plan/waterStrip';
import { paintBiomeDensityR8 } from '../../scenery/biomeDensity';
import { BANK_ATLAS_SIZE, paintBankAtlas } from '../../scenery/bankAtlas';
import type { SceneryProfile } from '../../services/routeEnrichmentService';
import bankWgsl from './bank.wgsl?raw';

export interface ShadowResources {
  uniforms: GPUBuffer;
  atlasView: GPUTextureView;
  cmpSampler: GPUSampler;
}

/** The biome whose density tile drives the bank's grass modulation (#496). */
export interface BankGrassConfig {
  profile: SceneryProfile;
  /** 0 disables the chunk at the shader level; 1 is React's full strength. */
  strength: number;
  /** Plan-view metres covered by one wrap of the tile. React uses 32. */
  tileMetres?: number;
  /** Density tile edge in texels; 256 matches `createBiomeDensityTile`'s default. */
  tileSize?: number;
}

export interface BankPassOptions {
  device: GPUDevice;
  format: GPUTextureFormat;
  frameUniforms: GPUBuffer;
  shadow: ShadowResources;
  /** Route curve the bank follows. Null → straight-line fallback. */
  curve?: RouteCurve | null;
  /** Same per-progress shore widths the water pass uses. */
  edgesForProgress?: (progress: number) => WaterEdges;
  /** Biome-density grass modulation. Omitted → chunk off (strength 0, fallback tile). */
  grass?: BankGrassConfig;
}

export const createBankPass = ({
  device,
  format,
  frameUniforms,
  shadow,
  curve = null,
  edgesForProgress,
  grass,
}: BankPassOptions): Pass => {
  const code = SHADOW_UNIFORMS_WGSL + SAMPLE_SHADOW_WGSL + bankWgsl;
  const module = device.createShaderModule({ label: 'bank', code });
  const pipeline = device.createRenderPipeline({
    label: 'bank',
    layout: 'auto',
    vertex: {
      module,
      entryPoint: 'vs_main',
      buffers: [
        {
          arrayStride: 12,
          attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }],
        },
        {
          // #591-fu P0b: 2 floats per vertex, (sign, shoreDist). The sign
          // kept its old ±1 meaning (left vs right strip); shoreDist is
          // metres from the water edge for the triplanar grass/earth mix.
          arrayStride: 8,
          attributes: [{ shaderLocation: 1, offset: 0, format: 'float32x2' }],
        },
      ],
    },
    fragment: { module, entryPoint: 'fs_main', targets: [{ format }] },
    primitive: { topology: 'triangle-list', cullMode: 'none' },
    depthStencil: {
      depthWriteEnabled: true,
      depthCompare: 'less',
      format: 'depth32float',
    },
  });
  const bindGroup = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: { buffer: frameUniforms } }],
  });
  const shadowBindGroup = device.createBindGroup({
    label: 'bank-shadow',
    layout: pipeline.getBindGroupLayout(1),
    entries: [
      { binding: 0, resource: { buffer: shadow.uniforms } },
      { binding: 1, resource: shadow.atlasView },
      { binding: 2, resource: shadow.cmpSampler },
    ],
  });

  // Grass density chunk resources (#496 Phase 2). The texture + sampler are
  // mounted even when `strength === 0` so the pipeline+bind-group graph
  // stays identical regardless of tier: a toggle only needs to rewrite the
  // uniform. The tile is `r8unorm` because the shader reads only `.r`,
  // which is 4× cheaper to upload than RGBA.
  const grassProfile: SceneryProfile = grass?.profile ?? 'fallback';
  const grassStrength = Math.max(0, Math.min(1, grass?.strength ?? 0));
  const grassTileMetres = grass?.tileMetres ?? 32;
  const grassTileSize = grass?.tileSize ?? 256;
  const grassPixels = paintBiomeDensityR8(grassProfile, grassTileSize);
  const grassTexture = device.createTexture({
    label: `bank-grass-tile:${grassProfile}`,
    size: { width: grassTileSize, height: grassTileSize },
    format: 'r8unorm',
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  });
  device.queue.writeTexture(
    { texture: grassTexture },
    grassPixels as BufferSource,
    { bytesPerRow: grassTileSize, rowsPerImage: grassTileSize },
    { width: grassTileSize, height: grassTileSize },
  );
  const grassSampler = device.createSampler({
    label: 'bank-grass-sampler',
    magFilter: 'linear',
    minFilter: 'linear',
    addressModeU: 'repeat',
    addressModeV: 'repeat',
  });
  const grassUniforms = device.createBuffer({
    label: 'bank-grass-uniforms',
    size: 16,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(
    grassUniforms,
    0,
    new Float32Array([grassStrength, grassTileMetres, 0, 0]),
  );
  // #591-fu P0b: shared grass+earth albedo atlas (left half grass, right
  // half earth). One tile per pass, `rgba8unorm-srgb`. Sampled twice in the
  // fragment and mixed by shore distance.
  const bankAtlasPixels = paintBankAtlas();
  const bankAtlasTexture = device.createTexture({
    label: 'bank-atlas',
    size: { width: BANK_ATLAS_SIZE, height: BANK_ATLAS_SIZE },
    format: 'rgba8unorm-srgb',
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  });
  device.queue.writeTexture(
    { texture: bankAtlasTexture },
    bankAtlasPixels as BufferSource,
    { bytesPerRow: BANK_ATLAS_SIZE * 4, rowsPerImage: BANK_ATLAS_SIZE },
    { width: BANK_ATLAS_SIZE, height: BANK_ATLAS_SIZE },
  );
  const bankAtlasSampler = device.createSampler({
    label: 'bank-atlas-sampler',
    magFilter: 'linear',
    minFilter: 'linear',
    addressModeU: 'repeat',
    addressModeV: 'repeat',
  });

  const grassBindGroup = device.createBindGroup({
    label: 'bank-grass',
    layout: pipeline.getBindGroupLayout(2),
    entries: [
      { binding: 0, resource: { buffer: grassUniforms } },
      { binding: 1, resource: grassTexture.createView() },
      { binding: 2, resource: grassSampler },
      { binding: 3, resource: bankAtlasTexture.createView() },
      { binding: 4, resource: bankAtlasSampler },
    ],
  });

  const geom = buildBankStrips({ curve, edgesForProgress });
  const positionBuffer = device.createBuffer({
    label: 'bank-pos',
    size: geom.positions.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(positionBuffer, 0, geom.positions as BufferSource);
  const sideBuffer = device.createBuffer({
    label: 'bank-side',
    size: geom.sides.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(sideBuffer, 0, geom.sides as BufferSource);
  const indexBuffer = device.createBuffer({
    label: 'bank-idx',
    size: geom.indices.byteLength,
    usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(indexBuffer, 0, geom.indices as BufferSource);

  let disposed = false;
  return {
    name: 'bank',
    encode(ctx: FrameContext) {
      if (disposed) return;
      const pass = ctx.encoder.beginRenderPass({
        label: 'bank',
        colorAttachments: [
          {
            view: ctx.swapView,
            loadOp: 'load',
            storeOp: 'store',
          },
        ],
        depthStencilAttachment: {
          view: ctx.depthView,
          depthLoadOp: 'load',
          depthStoreOp: 'store',
        },
      });
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bindGroup);
      pass.setBindGroup(1, shadowBindGroup);
      pass.setBindGroup(2, grassBindGroup);
      pass.setVertexBuffer(0, positionBuffer);
      pass.setVertexBuffer(1, sideBuffer);
      pass.setIndexBuffer(indexBuffer, 'uint16');
      pass.drawIndexed(geom.indices.length);
      pass.end();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      positionBuffer.destroy();
      sideBuffer.destroy();
      indexBuffer.destroy();
      grassTexture.destroy();
      grassUniforms.destroy();
      bankAtlasTexture.destroy();
    },
  };
};
