import type { WebGPUCullInput, WebGPUCullPort, WebGPUDevice } from './types';
import { publishDispatchTiming } from './health';
import foliageCullSource from './shaders/foliageCull.wgsl?raw';

/**
 * The real implementation of `WebGPUCullPort` (#498 FR3). Owns the GPU
 * buffers for one chunk of foliage and dispatches `foliageCull.wgsl` each
 * frame the caller asks for a cull.
 *
 * The buffers are sized for the chunk's instance count at creation and
 * stay that way; a bigger chunk means a bigger `createWebGPUCuller` later.
 * The compact index list comes back as a `Uint32Array` (D4-a) — a GPU-only
 * compacted matrix path (D4-c) would need a custom material three never
 * reads, which is a bigger project than a spike.
 */
export interface WebGPUCullerOptions {
  device: WebGPUDevice;
  instanceCount: number;
}

/** Byte layout of the uniform buffer; mirrors `CullUniforms` in the WGSL. */
const UNIFORM_SIZE_BYTES = (() => {
  // boat (vec2<f32> = 8 B) + rangeSquared (f32 = 4 B) + treeY (f32 = 4 B)
  //   + frustumPlanes (6 * vec4<f32> = 96 B) + instanceCount (u32 = 4 B)
  //   + _pad (vec3<u32> = 12 B) = 128 B.
  return 128;
})();

export const createWebGPUCuller = ({ device, instanceCount }: WebGPUCullerOptions): WebGPUCullPort => {
  const module = device.createShaderModule({ code: foliageCullSource });
  const pipeline = device.createComputePipeline({
    layout: 'auto',
    compute: { module, entryPoint: 'main' },
  });

  const uniformBuffer = device.createBuffer({
    size: UNIFORM_SIZE_BYTES,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const centresBuffer = device.createBuffer({
    size: Math.max(instanceCount, 1) * 2 * 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  const visibleIndicesBuffer = device.createBuffer({
    size: Math.max(instanceCount, 1) * 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
  });
  const visibleCountBuffer = device.createBuffer({
    size: 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
  });

  // One read-back buffer for the compacted indices and one for the count. We
  // keep them around rather than re-creating per dispatch, since map/unmap is
  // the frame-loop hotpath.
  const indicesReadback = device.createBuffer({
    size: Math.max(instanceCount, 1) * 4,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });
  const countReadback = device.createBuffer({
    size: 4,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });

  const bindGroup = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: uniformBuffer } },
      { binding: 1, resource: { buffer: centresBuffer } },
      { binding: 2, resource: { buffer: visibleIndicesBuffer } },
      { binding: 3, resource: { buffer: visibleCountBuffer } },
    ],
  });

  // The centres don't change frame-to-frame, so we upload once up front and
  // reuse. A later rev could `writeBuffer` only when the chunk changes.
  let centresUploaded = false;
  const uniformScratch = new ArrayBuffer(UNIFORM_SIZE_BYTES);

  const writeUniforms = (input: WebGPUCullInput): void => {
    const f32 = new Float32Array(uniformScratch);
    const u32 = new Uint32Array(uniformScratch);
    f32[0] = input.boat.x;
    f32[1] = input.boat.z;
    f32[2] = input.range * input.range;
    f32[3] = input.treeY;
    f32.set(input.frustumPlanes, 4);
    u32[28] = Math.min(instanceCount, input.centres.length / 2);
    device.queue.writeBuffer(uniformBuffer, 0, uniformScratch);
  };

  const cull = async (input: WebGPUCullInput): Promise<Uint32Array> => {
    if (!centresUploaded) {
      // The buffer-source types on queue.writeBuffer are strict about
      // ArrayBuffer vs. ArrayBufferLike; the caller-owned arrays are backed by
      // plain ArrayBuffers, so cast and move on.
      device.queue.writeBuffer(centresBuffer, 0, input.centres as unknown as ArrayBufferView<ArrayBuffer>);
      centresUploaded = true;
    }
    writeUniforms(input);
    device.queue.writeBuffer(visibleCountBuffer, 0, new Uint32Array([0]).buffer);

    const dispatchStart = performance.now();
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(Math.ceil(instanceCount / 64));
    pass.end();
    encoder.copyBufferToBuffer(visibleIndicesBuffer, 0, indicesReadback, 0, indicesReadback.size);
    encoder.copyBufferToBuffer(visibleCountBuffer, 0, countReadback, 0, 4);
    device.queue.submit([encoder.finish()]);
    await device.queue.onSubmittedWorkDone();
    const dispatchMs = performance.now() - dispatchStart;

    const readStart = performance.now();
    await Promise.all([
      countReadback.mapAsync(GPUMapMode.READ),
      indicesReadback.mapAsync(GPUMapMode.READ),
    ]);
    const count = new Uint32Array(countReadback.getMappedRange())[0];
    const indicesSource = new Uint32Array(indicesReadback.getMappedRange());
    const result = new Uint32Array(indicesSource.slice(0, count));
    countReadback.unmap();
    indicesReadback.unmap();
    const mappedReadMs = performance.now() - readStart;

    publishDispatchTiming(dispatchMs, mappedReadMs);
    return result;
  };

  const dispose = (): void => {
    uniformBuffer.destroy();
    centresBuffer.destroy();
    visibleIndicesBuffer.destroy();
    visibleCountBuffer.destroy();
    indicesReadback.destroy();
    countReadback.destroy();
  };

  return { cull, dispose };
};
