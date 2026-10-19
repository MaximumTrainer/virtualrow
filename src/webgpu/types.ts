// Local shim over the WebGPU surface we actually use.
//
// AC5 of #498 keeps the rest of the codebase type-only aware of WebGPU through
// a tiny port interface: `@webgpu/types` lives inside `src/webgpu/` only. Code
// outside this module depends on the structural `WebGPUCullPort` below, which
// a worker factory or a hand-rolled stub can implement without pulling in
// `GPUDevice`'s thousand ambient names.
//
// `@webgpu/types` is an ambient declaration package — pulled in with a
// triple-slash reference, not an `import`. We re-export the handful of names
// we need as locally-renamed `type` aliases so files inside this module get
// one import line rather than relying on the globals.

/// <reference types="@webgpu/types" />

export type WebGPUAdapter = GPUAdapter;
export type WebGPUAdapterInfo = GPUAdapterInfo;
export type WebGPUDevice = GPUDevice;

/**
 * The port the rest of the codebase depends on. Narrow by design — the whole
 * contract is "give me the visible indices of this frame's trees". A test
 * fakes it with a zero-dependency object; the real implementation lives in
 * `createWebGPUCuller`.
 */
export interface WebGPUCullPort {
  /**
   * Dispatch the compute kernel for one frame of foliage.
   *
   * `centres` is `(count * 2) * Float32` in xz-pairs (parity with
   * `FoliageBatch.centres`). `frustumPlanes` is six vec4 planes in three.js
   * ordering. The port returns the compact index list — a `Uint32Array` of
   * `visibleCount` entries, caller-owned.
   */
  cull(input: WebGPUCullInput): Promise<Uint32Array>;
  /** Release GPU buffers; safe to call more than once. */
  dispose(): void;
}

export interface WebGPUCullInput {
  centres: Float32Array;
  boat: { x: number; z: number };
  range: number;
  treeY: number;
  /** Six vec4 planes, xyzw = (A, B, C, D). */
  frustumPlanes: Float32Array;
}

/**
 * The telemetry object the spike publishes under
 * `window.__VIRTUALROW_WEBGPU_HEALTH`. All fields are optional on first read:
 * nothing is published until a device actually arrives.
 */
export interface WebGPUHealth {
  adapter?: string;
  isSoftware?: boolean;
  deviceLostCount: number;
  /** Milliseconds spent on the latest compute dispatch (as the queue saw it). */
  dispatchMs?: number;
  /** Milliseconds spent mapping the result buffer back to CPU memory. */
  mappedReadMs?: number;
  /** The reason this spike fell back to the CPU `cullTo`, if it did. */
  fallbackReason?: WebGPUFallbackReason;
}

export type WebGPUFallbackReason =
  | 'webgpu-unsupported'
  | 'software-adapter'
  | 'device-lost'
  | 'adapter-request-failed'
  | 'device-request-failed';
