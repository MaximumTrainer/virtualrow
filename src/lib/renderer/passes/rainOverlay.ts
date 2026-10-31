/**
 * Screen-space rain overlay (#574). Follows the simple one-draw pattern
 * of `clouds.ts` — pipeline + frame bind group + a `Pass` that encodes
 * one triangle each frame. The fragment shader
 * (`rainOverlay.wgsl`) owns the full procedural rain look.
 *
 * Opt-in only. The engine builds the pass when the tier cap says so,
 * AND the viewer has flipped the `window.__VIRTUALROW_RAIN` dev flag
 * so a mobile ride doesn't drown in rain by default. Hook up to real
 * weather data in a follow-up.
 */

/// <reference types="@webgpu/types" />

import type { FrameContext, Pass } from '../engine/frameGraph';
import rainWgsl from './rainOverlay.wgsl?raw';

export interface RainOverlayPassOptions {
  device: GPUDevice;
  format: GPUTextureFormat;
  frameUniforms: GPUBuffer;
}

export const createRainOverlayPass = ({
  device,
  format,
  frameUniforms,
}: RainOverlayPassOptions): Pass => {
  const module = device.createShaderModule({ label: 'rain-overlay', code: rainWgsl });
  const pipeline = device.createRenderPipeline({
    label: 'rain-overlay',
    layout: 'auto',
    vertex: { module, entryPoint: 'vs_main' },
    fragment: {
      module,
      entryPoint: 'fs_main',
      targets: [
        {
          format,
          blend: {
            // Pre-multiplied alpha — the shader already outputs
            // `colour * alpha`, so src factor is `one`.
            color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
            alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
          },
        },
      ],
    },
    primitive: { topology: 'triangle-list' },
    depthStencil: {
      depthWriteEnabled: false,
      depthCompare: 'less-equal',
      format: 'depth32float',
    },
  });
  const bindGroup = device.createBindGroup({
    label: 'rain-overlay-frame',
    layout: pipeline.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: { buffer: frameUniforms } }],
  });
  let disposed = false;
  return {
    name: 'rain-overlay',
    encode(ctx: FrameContext) {
      if (disposed) return;
      const pass = ctx.encoder.beginRenderPass({
        label: 'rain-overlay',
        colorAttachments: [{ view: ctx.swapView, loadOp: 'load', storeOp: 'store' }],
        depthStencilAttachment: {
          view: ctx.depthView,
          depthLoadOp: 'load',
          depthStoreOp: 'store',
        },
      });
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bindGroup);
      pass.draw(3, 1, 0, 0);
      pass.end();
    },
    dispose() {
      disposed = true;
    },
  };
};
