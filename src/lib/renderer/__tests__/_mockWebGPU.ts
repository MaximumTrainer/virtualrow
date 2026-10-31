/**
 * Minimal in-memory WebGPU mock for Vitest. The engine's calls land here;
 * nothing is validated against the WebGPU spec. Device methods record calls
 * so a spec can assert pass order and the "one submit per frame" invariant.
 */

/// <reference types="@webgpu/types" />

// `GPUBufferUsage` / `GPUTextureUsage` / `GPUShaderStage` are globals at
// runtime in a WebGPU browser; jsdom doesn't define them, so the engine's
// references throw `ReferenceError` under Vitest. Shim them with the usage
// values from the WebGPU spec so the engine can be loaded without touching
// the real driver.
const g = globalThis as unknown as Record<string, unknown>;
if (!g['GPUBufferUsage']) {
  g['GPUBufferUsage'] = {
    MAP_READ: 0x0001,
    MAP_WRITE: 0x0002,
    COPY_SRC: 0x0004,
    COPY_DST: 0x0008,
    INDEX: 0x0010,
    VERTEX: 0x0020,
    UNIFORM: 0x0040,
    STORAGE: 0x0080,
    INDIRECT: 0x0100,
    QUERY_RESOLVE: 0x0200,
  };
}
if (!g['GPUTextureUsage']) {
  g['GPUTextureUsage'] = {
    COPY_SRC: 0x01,
    COPY_DST: 0x02,
    TEXTURE_BINDING: 0x04,
    STORAGE_BINDING: 0x08,
    RENDER_ATTACHMENT: 0x10,
  };
}
if (!g['GPUShaderStage']) {
  g['GPUShaderStage'] = {
    VERTEX: 0x1,
    FRAGMENT: 0x2,
    COMPUTE: 0x4,
  };
}
if (!g['GPUMapMode']) {
  g['GPUMapMode'] = {
    READ: 0x0001,
    WRITE: 0x0002,
  };
}

export interface MockGPULog {
  submits: number;
  encoderPasses: string[];
  computePasses: string[];
  createdPipelines: string[];
  createdComputePipelines: string[];
  destroyedBuffers: number;
  computeDispatches: number;
  indirectDraws: number;
}

export interface MockDevice extends GPUDevice {
  __log: MockGPULog;
  __triggerLost(message?: string): void;
}

export const makeMockDevice = (): MockDevice => {
  const log: MockGPULog = {
    submits: 0,
    encoderPasses: [],
    computePasses: [],
    createdPipelines: [],
    createdComputePipelines: [],
    destroyedBuffers: 0,
    computeDispatches: 0,
    indirectDraws: 0,
  };

  let resolveLost: (reason: GPUDeviceLostInfo) => void = () => undefined;
  const lost = new Promise<GPUDeviceLostInfo>((resolve) => {
    resolveLost = resolve;
  });

  const makeBuffer = (): GPUBuffer => ({
    destroy: () => {
      log.destroyedBuffers += 1;
    },
    mapAsync: async () => undefined,
    getMappedRange: () => new ArrayBuffer(0),
    unmap: () => undefined,
    size: 0,
    usage: 0,
    mapState: 'unmapped',
    label: '',
  }) as unknown as GPUBuffer;

  const makePipeline = (label: string): GPURenderPipeline =>
    ({
      label,
      getBindGroupLayout: () => ({ label: 'auto' }) as GPUBindGroupLayout,
    }) as unknown as GPURenderPipeline;

  const makeComputePipeline = (label: string): GPUComputePipeline =>
    ({
      label,
      getBindGroupLayout: () => ({ label: 'auto-compute' }) as GPUBindGroupLayout,
    }) as unknown as GPUComputePipeline;

  const makePass = (name: string): GPURenderPassEncoder => {
    log.encoderPasses.push(name);
    return {
      setPipeline: () => undefined,
      setBindGroup: () => undefined,
      setVertexBuffer: () => undefined,
      setIndexBuffer: () => undefined,
      draw: () => undefined,
      drawIndexed: () => undefined,
      drawIndirect: () => {
        log.indirectDraws += 1;
      },
      drawIndexedIndirect: () => {
        log.indirectDraws += 1;
      },
      setViewport: () => undefined,
      setScissorRect: () => undefined,
      end: () => undefined,
    } as unknown as GPURenderPassEncoder;
  };

  const makeComputePassEncoder = (name: string): GPUComputePassEncoder => {
    log.computePasses.push(name);
    return {
      setPipeline: () => undefined,
      setBindGroup: () => undefined,
      dispatchWorkgroups: () => {
        log.computeDispatches += 1;
      },
      dispatchWorkgroupsIndirect: () => {
        log.computeDispatches += 1;
      },
      end: () => undefined,
    } as unknown as GPUComputePassEncoder;
  };

  const encoder = {
    beginRenderPass: (desc: GPURenderPassDescriptor) =>
      makePass((desc.label ?? 'pass') as string),
    beginComputePass: (desc?: GPUComputePassDescriptor) =>
      makeComputePassEncoder((desc?.label ?? 'compute') as string),
    finish: () => ({} as GPUCommandBuffer),
    label: '',
  } as unknown as GPUCommandEncoder;

  const device: Partial<MockDevice> = {
    __log: log,
    __triggerLost(message = 'test') {
      resolveLost({ reason: 'unknown', message } as GPUDeviceLostInfo);
    },
    lost,
    // No optional features by default, so the GPU frame timer (#584 AC3) and
    // anything else gated on `device.features.has(...)` takes its absent path.
    features: new Set() as unknown as GPUSupportedFeatures,
    createBuffer: () => makeBuffer(),
    createShaderModule: () => ({ label: '' }) as unknown as GPUShaderModule,
    createBindGroupLayout: () => ({}) as unknown as GPUBindGroupLayout,
    createPipelineLayout: () => ({}) as unknown as GPUPipelineLayout,
    createRenderPipeline: (desc: GPURenderPipelineDescriptor) => {
      const p = makePipeline((desc.label ?? '') as string);
      log.createdPipelines.push((desc.label ?? '') as string);
      return p;
    },
    createComputePipeline: (desc: GPUComputePipelineDescriptor) => {
      const p = makeComputePipeline((desc.label ?? '') as string);
      log.createdComputePipelines.push((desc.label ?? '') as string);
      return p;
    },
    createBindGroup: () => ({}) as unknown as GPUBindGroup,
    createTexture: () =>
      ({
        createView: () => ({}) as GPUTextureView,
        destroy: () => undefined,
      }) as unknown as GPUTexture,
    createSampler: () => ({ label: 'sampler' }) as unknown as GPUSampler,
    createCommandEncoder: () => encoder,
    destroy: () => undefined,
    queue: {
      writeBuffer: () => undefined,
      writeTexture: () => undefined,
      submit: () => {
        log.submits += 1;
      },
    } as unknown as GPUQueue,
    label: 'mock-device',
  };

  return device as MockDevice;
};

export interface MockAdapterOpts {
  software?: boolean;
  info?: Partial<GPUAdapterInfo>;
  deviceFails?: boolean;
}

export const makeMockAdapter = (opts: MockAdapterOpts = {}): GPUAdapter => {
  const info: Partial<GPUAdapterInfo> = {
    vendor: opts.software ? 'swiftshader' : 'mock',
    architecture: opts.software ? 'swiftshader' : 'mock-arch',
    device: 'mock-device',
    description: 'mock',
    ...opts.info,
  };
  return {
    info: info as GPUAdapterInfo,
    isFallbackAdapter: !!opts.software,
    requestDevice: async () => {
      if (opts.deviceFails) throw new Error('device-request-failed');
      return makeMockDevice();
    },
    features: new Set() as unknown as GPUSupportedFeatures,
    limits: {} as GPUSupportedLimits,
  } as unknown as GPUAdapter;
};

export const makeMockGPU = (adapterOrNull: GPUAdapter | null | 'throw'): GPU => ({
  requestAdapter: async () => {
    if (adapterOrNull === 'throw') throw new Error('adapter-request-failed');
    return adapterOrNull;
  },
  getPreferredCanvasFormat: () => 'bgra8unorm' as GPUTextureFormat,
}) as unknown as GPU;

export const installGPUStub = (gpu: GPU | undefined): void => {
  const win = globalThis as unknown as { navigator: Navigator };
  Object.defineProperty(win.navigator, 'gpu', {
    configurable: true,
    get: () => gpu,
  });
};

export const makeMockCanvas = (device?: MockDevice): HTMLCanvasElement => {
  const attrs: Record<string, string> = {};
  const canvas = {
    width: 320,
    height: 240,
    clientWidth: 320,
    clientHeight: 240,
    setAttribute(k: string, v: string) {
      attrs[k] = v;
    },
    removeAttribute(k: string) {
      delete attrs[k];
    },
    getAttribute(k: string) {
      return attrs[k] ?? null;
    },
    getContext(kind: string) {
      if (kind !== 'webgpu') return null;
      return {
        configure: () => undefined,
        getCurrentTexture: () =>
          ({
            createView: () => ({}),
          }) as unknown as GPUTexture,
        device,
      } as unknown as GPUCanvasContext;
    },
  } as unknown as HTMLCanvasElement;
  return canvas;
};
