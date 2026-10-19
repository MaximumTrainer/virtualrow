import { describe, expect, it, vi } from 'vitest';
import type { WebGPUDevice } from '../webgpu/types';

// jsdom does not define the WebGPU usage flag enums. Stub them before the
// module import below reads them.
vi.stubGlobal('GPUBufferUsage', {
  UNIFORM: 1,
  STORAGE: 2,
  COPY_DST: 4,
  COPY_SRC: 8,
  MAP_READ: 16,
});
vi.stubGlobal('GPUMapMode', { READ: 1 });

const { createWebGPUCuller } = await import('../webgpu/createWebGPUCuller');

/**
 * Test the port's control flow with a minimal device stub. The real kernel
 * only runs on a GPU — Playwright owns that end — but the structure of the
 * uniform payload, the dispatch workgroup count, and the buffer sizes are
 * all plain JS that we can pin here.
 */

interface Buffer {
  size: number;
  usage: number;
  writes: Array<{ offset: number; data: ArrayBuffer }>;
  mapped?: ArrayBuffer;
  destroyed: boolean;
  destroy(): void;
  mapAsync(): Promise<void>;
  getMappedRange(): ArrayBuffer;
  unmap(): void;
}

const stubDevice = () => {
  const buffers: Buffer[] = [];
  const dispatched: number[] = [];
  const stub = {
    createShaderModule: () => ({}),
    createComputePipeline: () => ({
      getBindGroupLayout: () => ({}),
    }),
    createBuffer: (desc: { size: number; usage: number }) => {
      const buffer: Buffer = {
        size: desc.size,
        usage: desc.usage,
        writes: [],
        destroyed: false,
        destroy() {
          this.destroyed = true;
        },
        async mapAsync() {
          /* no-op */
        },
        getMappedRange(): ArrayBuffer {
          return this.mapped ?? new ArrayBuffer(this.size);
        },
        unmap() {
          /* no-op */
        },
      } as Buffer;
      buffers.push(buffer);
      return buffer;
    },
    createBindGroup: () => ({}),
    createCommandEncoder: () => ({
      beginComputePass: () => ({
        setPipeline() {},
        setBindGroup() {},
        dispatchWorkgroups(x: number) {
          dispatched.push(x);
        },
        end() {},
      }),
      copyBufferToBuffer() {},
      finish() {
        return {};
      },
    }),
    queue: {
      writeBuffer(buffer: Buffer, offset: number, data: ArrayBuffer | ArrayBufferView) {
        const payload =
          data instanceof ArrayBuffer
            ? data
            : (data.buffer as ArrayBuffer).slice(
                data.byteOffset,
                data.byteOffset + data.byteLength,
              );
        buffer.writes.push({ offset, data: payload });
      },
      submit() {},
      onSubmittedWorkDone: () => Promise.resolve(),
    },
  };
  return { stub: stub as unknown as WebGPUDevice, buffers, dispatched };
};

describe('createWebGPUCuller (#498 Phase 2a)', () => {
  it('allocates the six buffers at creation and destroys them on dispose', () => {
    const { stub, buffers } = stubDevice();
    const port = createWebGPUCuller({ device: stub, instanceCount: 128 });
    expect(buffers).toHaveLength(6);
    port.dispose();
    expect(buffers.every((b) => b.destroyed)).toBe(true);
  });

  it('dispatches ceil(instanceCount / 64) workgroups and writes uniforms + count-reset', async () => {
    const { stub, buffers, dispatched } = stubDevice();
    const port = createWebGPUCuller({ device: stub, instanceCount: 130 });
    const frustumPlanes = new Float32Array(24);
    // Mapped read-back: the first word is the count the kernel wrote.
    const countReadback = buffers[5];
    const countArray = new ArrayBuffer(4);
    new Uint32Array(countArray)[0] = 0;
    countReadback.mapped = countArray;
    const indicesReadback = buffers[4];
    indicesReadback.mapped = new ArrayBuffer(130 * 4);
    await port.cull({
      centres: new Float32Array(130 * 2),
      boat: { x: 10, z: -5 },
      range: 400,
      treeY: 1.2,
      frustumPlanes,
    });
    expect(dispatched).toEqual([Math.ceil(130 / 64)]);
    const uniformWrites = buffers[0].writes;
    expect(uniformWrites).toHaveLength(1);
    const u = new Float32Array(uniformWrites[0].data);
    expect(u[0]).toBe(10); // boat.x
    expect(u[1]).toBe(-5); // boat.z
    expect(u[2]).toBeCloseTo(400 * 400); // rangeSquared
    expect(u[3]).toBeCloseTo(1.2); // treeY
    const uInts = new Uint32Array(uniformWrites[0].data);
    expect(uInts[28]).toBe(130); // instanceCount word
    const countWrites = buffers[3].writes;
    expect(countWrites).toHaveLength(1);
    expect(new Uint32Array(countWrites[0].data)[0]).toBe(0);
  });

  it('uploads centres only once across repeated culls', async () => {
    const { stub, buffers } = stubDevice();
    const port = createWebGPUCuller({ device: stub, instanceCount: 4 });
    buffers[5].mapped = new ArrayBuffer(4);
    buffers[4].mapped = new ArrayBuffer(16);
    const input = {
      centres: new Float32Array([0, 0, 1, 1, 2, 2, 3, 3]),
      boat: { x: 0, z: 0 },
      range: 10,
      treeY: 0,
      frustumPlanes: new Float32Array(24),
    };
    await port.cull(input);
    await port.cull(input);
    // Buffer 1 is the centres buffer.
    expect(buffers[1].writes).toHaveLength(1);
  });

  it('returns a slice of the mapped indices sized to the atomic count', async () => {
    const { stub, buffers } = stubDevice();
    const port = createWebGPUCuller({ device: stub, instanceCount: 8 });
    const countArray = new ArrayBuffer(4);
    new Uint32Array(countArray)[0] = 3;
    buffers[5].mapped = countArray;
    const indicesArray = new ArrayBuffer(8 * 4);
    new Uint32Array(indicesArray).set([7, 1, 4, 999, 999, 999, 999, 999]);
    buffers[4].mapped = indicesArray;
    const result = await port.cull({
      centres: new Float32Array(16),
      boat: { x: 0, z: 0 },
      range: 1,
      treeY: 0,
      frustumPlanes: new Float32Array(24),
    });
    expect(Array.from(result)).toEqual([7, 1, 4]);
  });
});

