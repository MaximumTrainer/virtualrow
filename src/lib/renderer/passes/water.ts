/// <reference types="@webgpu/types" />

import type { FrameContext, Pass } from '../engine/frameGraph';
import { buildWaterStrip } from '../plan/waterStrip';
import waterWgsl from './water.wgsl?raw';

export interface WaterPassOptions {
  device: GPUDevice;
  format: GPUTextureFormat;
  frameUniforms: GPUBuffer;
}

export const createWaterPass = ({ device, format, frameUniforms }: WaterPassOptions): Pass => {
  const module = device.createShaderModule({ label: 'water', code: waterWgsl });
  const pipeline = device.createRenderPipeline({
    label: 'water',
    layout: 'auto',
    vertex: {
      module,
      entryPoint: 'vs_main',
      buffers: [
        {
          arrayStride: 12,
          attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }],
        },
      ],
    },
    fragment: { module, entryPoint: 'fs_main', targets: [{ format }] },
    primitive: { topology: 'triangle-list', cullMode: 'none' },
    depthStencil: {
      depthWriteEnabled: true,
      depthCompare: 'less',
      format: 'depth24plus',
    },
  });
  const bindGroup = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: { buffer: frameUniforms } }],
  });

  const geom = buildWaterStrip(null);
  const positionBuffer = device.createBuffer({
    label: 'water-pos',
    size: geom.positions.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(positionBuffer, 0, geom.positions as BufferSource);
  const indexBuffer = device.createBuffer({
    label: 'water-idx',
    size: geom.indices.byteLength,
    usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(indexBuffer, 0, geom.indices as BufferSource);

  let disposed = false;
  return {
    name: 'water',
    encode(ctx: FrameContext) {
      if (disposed) return;
      const pass = ctx.encoder.beginRenderPass({
        label: 'water',
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
      pass.setVertexBuffer(0, positionBuffer);
      pass.setIndexBuffer(indexBuffer, 'uint16');
      pass.drawIndexed(geom.indices.length);
      pass.end();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      positionBuffer.destroy();
      indexBuffer.destroy();
    },
  };
};
