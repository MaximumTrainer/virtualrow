import { beforeAll, describe, expect, it, vi } from 'vitest';
import { createRainOverlayPass } from '../rainOverlay';

/** The rain overlay is a one-draw procedural fullscreen pass. jsdom
 *  ships no WebGPU so stub the device + globals the pipeline needs. */

beforeAll(() => {
  (globalThis as unknown as { GPUShaderStage: Record<string, number> }).GPUShaderStage = {
    VERTEX: 1, FRAGMENT: 2,
  };
  (globalThis as unknown as { GPUBufferUsage: Record<string, number> }).GPUBufferUsage = {
    UNIFORM: 64, COPY_DST: 8,
  };
});

const makeDevice = () => {
  const log: { createdPipelines: string[]; renderPasses: string[]; draws: Array<{ v: number; i: number }> } = {
    createdPipelines: [],
    renderPasses: [],
    draws: [],
  };
  const pass = {
    setPipeline: vi.fn(),
    setBindGroup: vi.fn(),
    draw: vi.fn((v: number, i: number) => log.draws.push({ v, i })),
    end: vi.fn(),
  };
  const encoder = {
    beginRenderPass: vi.fn((desc: { label?: string }) => {
      if (desc.label) log.renderPasses.push(desc.label);
      return pass;
    }),
  } as unknown as GPUCommandEncoder;
  const device = {
    createShaderModule: vi.fn(() => ({})),
    createRenderPipeline: vi.fn((desc: { label?: string }) => {
      if (desc.label) log.createdPipelines.push(desc.label);
      return { getBindGroupLayout: vi.fn(() => ({})) };
    }),
    createBindGroup: vi.fn(() => ({})),
    queue: { writeBuffer: vi.fn() },
  } as unknown as GPUDevice;
  return { device, encoder, log, pass };
};

describe('createRainOverlayPass (#574)', () => {
  it('builds a single named pass and runs it once per encode', () => {
    const { device, encoder, log } = makeDevice();
    const frameUniforms = {} as unknown as GPUBuffer;
    const p = createRainOverlayPass({ device, format: 'bgra8unorm', frameUniforms });
    expect(p.name).toBe('rain-overlay');
    expect(log.createdPipelines).toContain('rain-overlay');
    p.encode({
      device,
      encoder,
      swapView: {} as GPUTextureView,
      outputView: {} as GPUTextureView,
      depthView: {} as GPUTextureView,
      width: 320,
      height: 240,
      frame: {} as never,
      colorCleared: true,
      depthCleared: true,
    });
    expect(log.renderPasses).toContain('rain-overlay');
    expect(log.draws).toEqual([{ v: 3, i: 1 }]);
    p.dispose();
  });

  it('becomes a no-op after dispose', () => {
    const { device, encoder, log } = makeDevice();
    const p = createRainOverlayPass({ device, format: 'bgra8unorm', frameUniforms: {} as unknown as GPUBuffer });
    p.dispose();
    p.encode({
      device,
      encoder,
      swapView: {} as GPUTextureView,
      outputView: {} as GPUTextureView,
      depthView: {} as GPUTextureView,
      width: 1,
      height: 1,
      frame: {} as never,
      colorCleared: true,
      depthCleared: true,
    });
    expect(log.renderPasses.length).toBe(0);
    expect(log.draws.length).toBe(0);
  });
});
