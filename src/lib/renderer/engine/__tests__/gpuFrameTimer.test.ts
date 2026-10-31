/// <reference types="@webgpu/types" />
import { describe, expect, it, vi } from 'vitest';
import '../../__tests__/_mockWebGPU'; // installs GPUBufferUsage globals
import { createGpuFrameTimer } from '../gpuFrameTimer';

/**
 * A device whose `timestamp-query` support and timestamp readings are
 * controllable, plus spies over the query/encoder calls the timer makes.
 */
const makeTimerDevice = (opts: { feature: boolean; t0?: bigint; t1?: bigint }) => {
  const calls = {
    renderPasses: [] as GPURenderPassTimestampWrites[],
    resolves: 0,
    copies: 0,
    destroyed: 0,
  };
  const stamps = new BigUint64Array([opts.t0 ?? 0n, opts.t1 ?? 0n]);

  const encoder = {
    beginRenderPass: (desc: GPURenderPassDescriptor) => {
      if (desc.timestampWrites) calls.renderPasses.push(desc.timestampWrites);
      return { end: () => undefined } as unknown as GPURenderPassEncoder;
    },
    resolveQuerySet: () => {
      calls.resolves += 1;
    },
    copyBufferToBuffer: () => {
      calls.copies += 1;
    },
  } as unknown as GPUCommandEncoder;

  const readBuffer = {
    mapAsync: () => Promise.resolve(),
    // slice(0) is called by the timer; return the bytes backing `stamps`.
    getMappedRange: () => stamps.buffer,
    unmap: () => undefined,
    destroy: () => {
      calls.destroyed += 1;
    },
  } as unknown as GPUBuffer;

  const device = {
    features: { has: (f: string) => opts.feature && f === 'timestamp-query' },
    createQuerySet: () => ({ destroy: () => { calls.destroyed += 1; } }) as unknown as GPUQuerySet,
    createBuffer: (desc: GPUBufferDescriptor) =>
      ((desc.usage & GPUBufferUsage.MAP_READ)
        ? readBuffer
        : { destroy: () => { calls.destroyed += 1; } }) as unknown as GPUBuffer,
  } as unknown as GPUDevice;

  return { device, encoder, calls };
};

describe('gpuFrameTimer', () => {
  it('is null on an adapter without timestamp-query', () => {
    const { device } = makeTimerDevice({ feature: false });
    expect(createGpuFrameTimer(device)).toBeNull();
  });

  it('brackets the frame with begin/end timestamp writes and resolves before submit', () => {
    const { device, encoder, calls } = makeTimerDevice({ feature: true });
    const timer = createGpuFrameTimer(device)!;
    expect(timer).not.toBeNull();
    expect(timer.gpuMs).toBe(0);

    const view = {} as GPUTextureView;
    timer.writeBegin(encoder, view);
    timer.writeEnd(encoder, view);
    timer.resolve(encoder);

    expect(calls.renderPasses).toHaveLength(2);
    expect(calls.renderPasses[0]).toMatchObject({ beginningOfPassWriteIndex: 0 });
    expect(calls.renderPasses[1]).toMatchObject({ endOfPassWriteIndex: 1 });
    expect(calls.resolves).toBe(1);
    expect(calls.copies).toBe(1);
  });

  it('reads back the GPU delta in milliseconds (nanosecond timestamps)', async () => {
    // 3_000_000 ns - 1_000_000 ns = 2_000_000 ns = 2 ms.
    const { device, calls } = makeTimerDevice({ feature: true, t0: 1_000_000n, t1: 3_000_000n });
    const timer = createGpuFrameTimer(device)!;
    timer.readback();
    await vi.waitFor(() => expect(timer.gpuMs).toBeCloseTo(2, 5));
    expect(calls).toBeTruthy();
  });

  it('does not start a second readback while one is in flight', async () => {
    let resolveMap: () => void = () => undefined;
    const stamps = new BigUint64Array([0n, 5_000_000n]);
    const readBuffer = {
      mapAsync: () => new Promise<void>((r) => { resolveMap = r; }),
      getMappedRange: () => stamps.buffer,
      unmap: () => undefined,
      destroy: () => undefined,
    } as unknown as GPUBuffer;
    const device = {
      features: { has: () => true },
      createQuerySet: () => ({ destroy: () => undefined }) as unknown as GPUQuerySet,
      createBuffer: (desc: GPUBufferDescriptor) =>
        ((desc.usage & GPUBufferUsage.MAP_READ) ? readBuffer : { destroy: () => undefined }) as unknown as GPUBuffer,
    } as unknown as GPUDevice;

    const timer = createGpuFrameTimer(device)!;
    timer.readback(); // starts a map that hasn't resolved
    timer.readback(); // must be a no-op while mapping
    expect(timer.gpuMs).toBe(0);
    resolveMap();
    await vi.waitFor(() => expect(timer.gpuMs).toBeCloseTo(5, 5));
  });

  it('frees its GPU resources on dispose', () => {
    const { device, calls } = makeTimerDevice({ feature: true });
    const timer = createGpuFrameTimer(device)!;
    timer.dispose();
    // query set + resolve buffer + read buffer.
    expect(calls.destroyed).toBe(3);
  });
});
