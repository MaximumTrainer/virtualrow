/// <reference types="@webgpu/types" />
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { createSceneryMeshPass, type SceneryMeshInput } from '../sceneryMesh';
import { mat4, mat4Identity } from '../../math/mat4';

// jsdom doesn't ship the WebGPU globals; the pass only reads
// GPUBufferUsage.*, so a numeric stub is enough for coverage.
beforeAll(() => {
  (globalThis as unknown as { GPUBufferUsage: Record<string, number> }).GPUBufferUsage = {
    VERTEX: 32, INDEX: 16, STORAGE: 128, UNIFORM: 64, COPY_DST: 8,
  };
});

/**
 * The pass is thin WebGPU wiring — no Node WebGPU implementation to run it
 * against — so these tests stub the device and check that the pass walks the
 * registry correctly: skips when no meshes are registered, skips when every
 * mesh has 0 instances, draws N instances when they're set, clamps to
 * `maxInstances`, and ignores a double `register` of the same id.
 */

const makeBuffer = () => ({
  destroy: vi.fn(),
  mapAsync: vi.fn(),
  getMappedRange: vi.fn(),
  unmap: vi.fn(),
}) as unknown as GPUBuffer;

const makePass = () => {
  const setBindGroup = vi.fn();
  const setPipeline = vi.fn();
  const setVertexBuffer = vi.fn();
  const setIndexBuffer = vi.fn();
  const drawIndexed = vi.fn();
  const end = vi.fn();
  const pass = { setBindGroup, setPipeline, setVertexBuffer, setIndexBuffer, drawIndexed, end } as unknown as GPURenderPassEncoder;
  return { pass, setBindGroup, setPipeline, drawIndexed, setIndexBuffer, end };
};

const makeDevice = () => {
  const queue = { writeBuffer: vi.fn() } as unknown as GPUQueue;
  const bindGroups: unknown[] = [];
  const device = {
    createShaderModule: vi.fn(() => ({})),
    createRenderPipeline: vi.fn(() => ({
      getBindGroupLayout: vi.fn(() => ({})),
    })),
    createBuffer: vi.fn(() => makeBuffer()),
    createBindGroup: vi.fn((desc: GPUBindGroupDescriptor) => {
      bindGroups.push(desc);
      return {} as GPUBindGroup;
    }),
    queue,
  } as unknown as GPUDevice;
  return { device, queue, bindGroups };
};

const makeInput = (over: Partial<SceneryMeshInput> = {}): SceneryMeshInput => ({
  id: over.id ?? 'test-mesh',
  positions: over.positions ?? new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
  normals: over.normals ?? new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0]),
  indices: over.indices ?? new Uint16Array([0, 1, 2]),
  baseColor: over.baseColor ?? [0.3, 0.5, 0.4, 1],
  maxInstances: over.maxInstances ?? 4,
});

describe('createSceneryMeshPass', () => {
  it('starts with no registered meshes', () => {
    const { device } = makeDevice();
    const frameBuf = makeBuffer();
    const p = createSceneryMeshPass({ device, format: 'bgra8unorm', frameUniforms: frameBuf });
    expect(p.meshCount).toBe(0);
  });

  it('registers a mesh and ignores a second register with the same id', () => {
    const { device } = makeDevice();
    const p = createSceneryMeshPass({ device, format: 'bgra8unorm', frameUniforms: makeBuffer() });
    p.register(makeInput({ id: 'buoy' }));
    expect(p.meshCount).toBe(1);
    p.register(makeInput({ id: 'buoy' }));
    expect(p.meshCount).toBe(1);
    p.register(makeInput({ id: 'post' }));
    expect(p.meshCount).toBe(2);
  });

  it('setInstances is a no-op for unknown ids', () => {
    const { device, queue } = makeDevice();
    const p = createSceneryMeshPass({ device, format: 'bgra8unorm', frameUniforms: makeBuffer() });
    const writeCountBefore = (queue.writeBuffer as unknown as { mock: { calls: unknown[] } }).mock.calls.length;
    p.setInstances('does-not-exist', [mat4Identity(mat4())]);
    const writeCountAfter = (queue.writeBuffer as unknown as { mock: { calls: unknown[] } }).mock.calls.length;
    expect(writeCountAfter).toBe(writeCountBefore);
  });

  it('clamps setInstances to the registered maxInstances', () => {
    const { device, queue } = makeDevice();
    const p = createSceneryMeshPass({ device, format: 'bgra8unorm', frameUniforms: makeBuffer() });
    p.register(makeInput({ id: 'buoy', maxInstances: 2 }));
    const writesBefore = (queue.writeBuffer as unknown as { mock: { calls: unknown[][] } }).mock.calls.length;
    p.setInstances('buoy', [mat4Identity(mat4()), mat4Identity(mat4()), mat4Identity(mat4()), mat4Identity(mat4())]);
    const writesAfter = (queue.writeBuffer as unknown as { mock: { calls: unknown[][] } }).mock.calls.length;
    // Clamped to 2 writes.
    expect(writesAfter - writesBefore).toBe(2);
  });

  it('encode skips when nothing is registered', () => {
    const { device } = makeDevice();
    const p = createSceneryMeshPass({ device, format: 'bgra8unorm', frameUniforms: makeBuffer() });
    const encoderBeginRenderPass = vi.fn();
    p.encode({ encoder: { beginRenderPass: encoderBeginRenderPass } } as unknown as Parameters<typeof p.encode>[0]);
    expect(encoderBeginRenderPass).not.toHaveBeenCalled();
  });

  it('encode skips when every registered mesh has 0 instances', () => {
    const { device } = makeDevice();
    const p = createSceneryMeshPass({ device, format: 'bgra8unorm', frameUniforms: makeBuffer() });
    p.register(makeInput({ id: 'buoy' }));
    const beginRenderPass = vi.fn();
    p.encode({ encoder: { beginRenderPass } } as unknown as Parameters<typeof p.encode>[0]);
    expect(beginRenderPass).not.toHaveBeenCalled();
  });

  it('encode draws per-mesh when instances are set', () => {
    const { device } = makeDevice();
    const p = createSceneryMeshPass({ device, format: 'bgra8unorm', frameUniforms: makeBuffer() });
    p.register(makeInput({ id: 'buoy', maxInstances: 4 }));
    p.register(makeInput({ id: 'post', maxInstances: 4, indices: new Uint32Array([0, 1, 2]) }));
    p.setInstances('buoy', [mat4Identity(mat4()), mat4Identity(mat4())]);
    p.setInstances('post', [mat4Identity(mat4())]);
    const { pass, drawIndexed, end } = makePass();
    const beginRenderPass = vi.fn(() => pass);
    p.encode({
      encoder: { beginRenderPass },
      swapView: {},
      depthView: {},
    } as unknown as Parameters<typeof p.encode>[0]);
    expect(beginRenderPass).toHaveBeenCalledTimes(1);
    // One drawIndexed per registered-with-instances mesh.
    expect(drawIndexed).toHaveBeenCalledTimes(2);
    // 3 indices per mesh, 2 instances for buoy, 1 for post.
    expect(drawIndexed.mock.calls[0][1]).toBe(2);
    expect(drawIndexed.mock.calls[1][1]).toBe(1);
    expect(end).toHaveBeenCalled();
  });

  it('dispose destroys every registered mesh buffer and clears the registry', () => {
    const { device } = makeDevice();
    const p = createSceneryMeshPass({ device, format: 'bgra8unorm', frameUniforms: makeBuffer() });
    p.register(makeInput({ id: 'buoy' }));
    expect(p.meshCount).toBe(1);
    p.dispose();
    expect(p.meshCount).toBe(0);
    // Calling dispose again is idempotent.
    p.dispose();
    expect(p.meshCount).toBe(0);
  });

  it('encode is a no-op after dispose', () => {
    const { device } = makeDevice();
    const p = createSceneryMeshPass({ device, format: 'bgra8unorm', frameUniforms: makeBuffer() });
    p.register(makeInput({ id: 'buoy' }));
    p.setInstances('buoy', [mat4Identity(mat4())]);
    p.dispose();
    const beginRenderPass = vi.fn();
    p.encode({ encoder: { beginRenderPass } } as unknown as Parameters<typeof p.encode>[0]);
    expect(beginRenderPass).not.toHaveBeenCalled();
  });
});
