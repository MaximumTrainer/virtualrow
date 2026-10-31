/**
 * Hull wake particles pass (#571). Instanced camera-facing billboards —
 * one draw per frame with instance count = `wakeState.size`. The CPU
 * side (`engine/wakeParticles.ts`) runs the particle sim; this file owns
 * the GPU pipeline + storage upload + draw.
 *
 * Drawn after the water pass and after the lit opaque passes so the foam
 * blends over whatever colour the water carries. Depth-tests against the
 * scene so a particle below the hull isn't visible through the shell,
 * but does not WRITE depth (same convention as clouds + sprites).
 */

/// <reference types="@webgpu/types" />

import type { FrameContext, Pass } from '../engine/frameGraph';
import {
  WAKE_FLOATS_PER_PARTICLE,
  type WakeState,
} from '../engine/wakeParticles';
import wakeWgsl from './wakeParticles.wgsl?raw';

export interface WakeParticlesPassOptions {
  device: GPUDevice;
  format: GPUTextureFormat;
  frameUniforms: GPUBuffer;
  /** Shared mutable wake state; the ride loop calls `updateWake` on this
   *  before `graph.run` so the storage buffer picks up fresh data. */
  wakeState: WakeState;
}

export const createWakeParticlesPass = ({
  device,
  format,
  frameUniforms,
  wakeState,
}: WakeParticlesPassOptions): Pass => {
  const module = device.createShaderModule({ label: 'wake', code: wakeWgsl });
  const pipeline = device.createRenderPipeline({
    label: 'wake',
    layout: 'auto',
    vertex: { module, entryPoint: 'vs_main' },
    fragment: {
      module,
      entryPoint: 'fs_main',
      targets: [
        {
          format,
          blend: {
            // Pre-multiplied alpha — the shader multiplies colour by alpha
            // so adjacent particles stack to a brighter foam cap without
            // over-washing the water underneath.
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
    label: 'wake-particles',
    size: wakeState.pool.byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  const bindGroup0 = device.createBindGroup({
    label: 'wake-frame',
    layout: pipeline.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: { buffer: frameUniforms } }],
  });
  const bindGroup2 = device.createBindGroup({
    label: 'wake-particles',
    layout: pipeline.getBindGroupLayout(2),
    entries: [{ binding: 0, resource: { buffer: particleBuffer } }],
  });

  const instanceCount = wakeState.size;
  const vertsPerInstance = 6;
  let disposed = false;

  return {
    name: 'wake',
    encode(ctx: FrameContext) {
      if (disposed) return;
      // Push the current particle snapshot. The shader culls dead ones
      // with a zero-scale collapse, so a lightly-populated frame still
      // runs the full instanced draw but costs almost nothing per dead
      // particle (triangles degenerate to a point).
      device.queue.writeBuffer(particleBuffer, 0, wakeState.pool as BufferSource);
      const pass = ctx.encoder.beginRenderPass({
        label: 'wake',
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
      // module + pipeline + bindGroups are owned by the device-lifetime
      // factory, nothing to free here on the current WebGPU surface.
    },
  };
};

/** The number of floats each particle occupies in the storage buffer.
 *  Re-exported so the pass tests + engine wiring can assert the layout
 *  the shader reads matches what the CPU writes. */
export const WAKE_PARTICLE_STRIDE_FLOATS = WAKE_FLOATS_PER_PARTICLE;
