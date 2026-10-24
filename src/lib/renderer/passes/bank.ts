/// <reference types="@webgpu/types" />

import type { FrameContext, Pass } from '../engine/frameGraph';
import { SAMPLE_SHADOW_WGSL, SHADOW_UNIFORMS_WGSL } from '../engine/shaderSnippets';
import { buildBankStrips } from '../plan/bankStrip';
import bankWgsl from './bank.wgsl?raw';

export interface ShadowResources {
  uniforms: GPUBuffer;
  atlasView: GPUTextureView;
  cmpSampler: GPUSampler;
}

export interface BankPassOptions {
  device: GPUDevice;
  format: GPUTextureFormat;
  frameUniforms: GPUBuffer;
  shadow: ShadowResources;
}

export const createBankPass = ({
  device,
  format,
  frameUniforms,
  shadow,
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
          arrayStride: 4,
          attributes: [{ shaderLocation: 1, offset: 0, format: 'float32' }],
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

  const geom = buildBankStrips();
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
    },
  };
};
