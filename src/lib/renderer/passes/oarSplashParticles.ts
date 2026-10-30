/**
 * Oar-blade splash particles pass (#571). Same instanced-billboard shape
 * as `wakeParticles.ts`; the fragment shader paints a short-lived spray
 * droplet arcing out from the blade.
 */

/// <reference types="@webgpu/types" />

import type { FrameContext, Pass } from '../engine/frameGraph';
import type { OarSplashState } from '../engine/oarSplashParticles';
import oarSplashWgsl from './oarSplashParticles.wgsl?raw';

export interface OarSplashPassOptions {
  device: GPUDevice;
  format: GPUTextureFormat;
  frameUniforms: GPUBuffer;
  state: OarSplashState;
}

export const createOarSplashPass = ({
  device,
  format,
  frameUniforms,
  state,
}: OarSplashPassOptions): Pass => {
  const module = device.createShaderModule({ label: 'oar-splash', code: oarSplashWgsl });
  const pipeline = device.createRenderPipeline({
    label: 'oar-splash',
    layout: 'auto',
    vertex: { module, entryPoint: 'vs_main' },
    fragment: {
      module,
      entryPoint: 'fs_main',
      targets: [
        {
          format,
          blend: {
            // Pre-multiplied alpha, same as wake.
            color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
            alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
          },
        },
      ],
    },
    primitive: { topology: 'triangle-list', cullMode: 'none' },
    depthStencil: {
      depthWriteEnabled: false,
      depthCompare: 'less-equal',
      format: 'depth32float',
    },
  });

  const particleBuffer = device.createBuffer({
    label: 'oar-splash-particles',
    size: state.pool.byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  const bindGroup0 = device.createBindGroup({
    label: 'oar-splash-frame',
    layout: pipeline.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: { buffer: frameUniforms } }],
  });
  const bindGroup2 = device.createBindGroup({
    label: 'oar-splash-particles',
    layout: pipeline.getBindGroupLayout(2),
    entries: [{ binding: 0, resource: { buffer: particleBuffer } }],
  });

  const instanceCount = state.size;
  const vertsPerInstance = 6;
  let disposed = false;

  return {
    name: 'oar-splash',
    encode(ctx: FrameContext) {
      if (disposed) return;
      device.queue.writeBuffer(particleBuffer, 0, state.pool as BufferSource);
      const pass = ctx.encoder.beginRenderPass({
        label: 'oar-splash',
        colorAttachments: [{ view: ctx.swapView, loadOp: 'load', storeOp: 'store' }],
        depthStencilAttachment: {
          view: ctx.depthView,
          depthLoadOp: 'load',
          depthStoreOp: 'store',
        },
      });
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bindGroup0);
      pass.setBindGroup(2, bindGroup2);
      pass.draw(vertsPerInstance, instanceCount, 0, 0);
      pass.end();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      particleBuffer.destroy();
    },
  };
};
