/**
 * The engine's render graph: an ordered list of `Pass`es, each handed a
 * `FrameContext` once per frame. D2-b of #550: flat and simple now, grows
 * into an explicit frame-graph in later phases without rewriting the three
 * passes landed in P2.
 *
 * The orchestrator does three things per frame:
 *   1. Update the `frame` uniform block (view/proj/time/sun/fog).
 *   2. Record every pass's commands into one command encoder.
 *   3. Submit exactly once.
 *
 * That "exactly once" is tested by P2-AC3 (device spy over `queue.submit`).
 */

/// <reference types="@webgpu/types" />

import type { Mat4 } from '../math/mat4';

/** Shared uniform block uploaded once per frame. */
export interface FrameUniforms {
  view: Mat4;
  proj: Mat4;
  viewProj: Mat4;
  camPos: Float32Array; // vec3
  sunDir: Float32Array; // vec3
  fog: Float32Array; // (nearDensity, farDensity, _, _)
  time: number;
  /** #567 "Animated cloud flow": a 2D wind vector in UV / second (world
   * stays zero on Y). Packed into the previously-pad slot after `time` so
   * the uniform-buffer size does not change. Optional — callers that don't
   * set it pack zero and the cloud shader reads a static sky. */
  wind?: Float32Array; // vec2 (x, z)
}

export interface FrameContext {
  device: GPUDevice;
  encoder: GPUCommandEncoder;
  /**
   * The colour attachment lit passes render into. Before P8 this was the
   * swap-chain back-buffer directly; from P8 onwards it's an HDR offscreen
   * texture that `PostFxPass` reads and composites to `outputView`.
   */
  swapView: GPUTextureView;
  /** The actual swap-chain back-buffer `PostFxPass` writes to. */
  outputView: GPUTextureView;
  depthView: GPUTextureView;
  width: number;
  height: number;
  frame: FrameUniforms;
  /** How many colour clears the sky pass has already issued. */
  colorCleared: boolean;
  /** How many depth clears have been issued; the first pass sets `depthCleared`. */
  depthCleared: boolean;
}

export interface Pass {
  /** Name used in the frame-graph record (also appears in telemetry). */
  readonly name: string;
  /**
   * Record this pass's commands into the frame's encoder. May be a no-op
   * if the pass has no work this frame.
   */
  encode(ctx: FrameContext): void;
  /** Release GPU resources. Safe to call more than once. */
  dispose(): void;
}

export interface FrameGraph {
  readonly passes: readonly Pass[];
  run(
    device: GPUDevice,
    swapView: GPUTextureView,
    depthView: GPUTextureView,
    width: number,
    height: number,
    frame: FrameUniforms,
    outputView?: GPUTextureView,
  ): void;
  dispose(): void;
}

export const createFrameGraph = (passes: Pass[]): FrameGraph => {
  let disposed = false;
  return {
    get passes() {
      return passes;
    },
    run(device, swapView, depthView, width, height, frame, outputView) {
      if (disposed) return;
      const encoder = device.createCommandEncoder({ label: 'engine-frame' });
      const ctx: FrameContext = {
        device,
        encoder,
        swapView,
        outputView: outputView ?? swapView,
        depthView,
        width,
        height,
        frame,
        colorCleared: false,
        depthCleared: false,
      };
      for (const pass of passes) {
        pass.encode(ctx);
      }
      device.queue.submit([encoder.finish()]);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const pass of passes) pass.dispose();
    },
  };
};
