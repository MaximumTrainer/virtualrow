/// <reference types="@webgpu/types" />
/**
 * #584 AC3 / FR3 — GPU-side frame time via the `timestamp-query` feature.
 *
 * The engine already asks the adapter for `timestamp-query` when it has it
 * (device.ts), and `Rower3DFrameStats.gpuMs` has carried a `0` placeholder
 * since; this fills it. The device-encode time (`cpuMs`) is measured on the
 * CPU around the frame build in rideScene — useful, but it is not the time the
 * GPU spends. This timer reads the GPU clock at the start and end of the
 * frame's command stream and reports the delta.
 *
 * Mechanism: two zero-draw "bracket" render passes wrap the frame-graph's pass
 * loop inside the same command encoder. The first writes the GPU timestamp as
 * it *begins* (query index 0); the last writes it as it *ends* (index 1). The
 * GPU stamps each when its command stream reaches that point, so the delta
 * spans every pass between them. The brackets `load`/`store` their attachment
 * and draw nothing, so they never disturb the real passes' contents.
 *
 * Readback is one frame behind and never blocks: after submit we map the
 * resolved buffer asynchronously and update `gpuMs` when it resolves, skipping
 * any frame whose previous read is still in flight. When the adapter lacks the
 * feature {@link createGpuFrameTimer} returns `null` and the engine leaves
 * `gpuMs` at `0`, exactly as before — so this is inert on such hardware
 * (CI's SwiftShader among them).
 */

/** Bytes per timestamp query result (u64 nanoseconds). */
const TIMESTAMP_BYTES = 8;
/** One timestamp at frame start, one at frame end. */
const QUERY_COUNT = 2;

export interface GpuFrameTimer {
  /** Stamp the GPU clock at the start of the frame (query index 0). */
  writeBegin(encoder: GPUCommandEncoder, view: GPUTextureView): void;
  /** Stamp the GPU clock at the end of the frame (query index 1). */
  writeEnd(encoder: GPUCommandEncoder, view: GPUTextureView): void;
  /** Resolve the query set into the readback buffer. Call before submit. */
  resolve(encoder: GPUCommandEncoder): void;
  /** Kick the async readback. Call after submit; never blocks. */
  readback(): void;
  /** Most recently read GPU frame time in milliseconds (0 until the first read). */
  readonly gpuMs: number;
  dispose(): void;
}

/**
 * Build a frame timer, or `null` when the device has no `timestamp-query`
 * feature (the engine then leaves `gpuMs` at 0).
 */
export const createGpuFrameTimer = (device: GPUDevice): GpuFrameTimer | null => {
  if (!device.features.has('timestamp-query')) return null;

  let disposed = false;
  // True while an async map is in flight; the readback buffer may not be
  // copied into while it is mapped, so both resolve() and readback() skip.
  let mapping = false;
  let gpuMs = 0;

  const querySet = device.createQuerySet({ type: 'timestamp', count: QUERY_COUNT });
  const resolveBuffer = device.createBuffer({
    label: 'gpu-frame-timer-resolve',
    size: TIMESTAMP_BYTES * QUERY_COUNT,
    usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC,
  });
  const readBuffer = device.createBuffer({
    label: 'gpu-frame-timer-read',
    size: TIMESTAMP_BYTES * QUERY_COUNT,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });

  const bracket = (
    encoder: GPUCommandEncoder,
    view: GPUTextureView,
    timestampWrites: GPURenderPassTimestampWrites,
  ): void => {
    // A render pass that draws nothing: it exists only to carry the timestamp
    // write. `load`/`store` leaves the attachment exactly as it was.
    const pass = encoder.beginRenderPass({
      colorAttachments: [{ view, loadOp: 'load', storeOp: 'store' }],
      timestampWrites,
    });
    pass.end();
  };

  return {
    writeBegin(encoder, view) {
      if (!disposed) bracket(encoder, view, { querySet, beginningOfPassWriteIndex: 0 });
    },
    writeEnd(encoder, view) {
      if (!disposed) bracket(encoder, view, { querySet, endOfPassWriteIndex: 1 });
    },
    resolve(encoder) {
      if (disposed || mapping) return;
      encoder.resolveQuerySet(querySet, 0, QUERY_COUNT, resolveBuffer, 0);
      encoder.copyBufferToBuffer(
        resolveBuffer,
        0,
        readBuffer,
        0,
        TIMESTAMP_BYTES * QUERY_COUNT,
      );
    },
    readback() {
      if (disposed || mapping) return;
      mapping = true;
      readBuffer
        .mapAsync(GPUMapMode.READ)
        .then(() => {
          try {
            // Copy out before unmap; the mapped range is detached on unmap.
            const stamps = new BigUint64Array(readBuffer.getMappedRange().slice(0));
            const delta = stamps[1] - stamps[0];
            // Timestamps are nanoseconds. Guard against a zero/negative delta
            // from an unwritten query or counter wrap.
            if (delta > 0n) gpuMs = Number(delta) / 1e6;
          } finally {
            readBuffer.unmap();
            mapping = false;
          }
        })
        .catch(() => {
          // A lost device rejects the map; drop this read and keep the last
          // good value rather than throwing into the frame loop.
          mapping = false;
        });
    },
    get gpuMs() {
      return gpuMs;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      querySet.destroy();
      resolveBuffer.destroy();
      readBuffer.destroy();
    },
  };
};
