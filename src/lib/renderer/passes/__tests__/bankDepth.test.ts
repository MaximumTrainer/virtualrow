import { describe, expect, it, vi, beforeAll } from 'vitest';
import { createBankDepthPipeline } from '../bankDepth';
import { RouteCurve } from '../../math/curve';
import { vec3 } from '../../math/vec3';

/** The bank-depth pipeline is thin WebGPU wiring over `buildBankStrips`.
 * jsdom doesn't ship WebGPU; stub the device + globals so we can exercise
 * the new curve/edges plumbing without a GPU. */

beforeAll(() => {
  (globalThis as unknown as { GPUShaderStage: Record<string, number> }).GPUShaderStage = {
    VERTEX: 1, FRAGMENT: 2,
  };
  (globalThis as unknown as { GPUBufferUsage: Record<string, number> }).GPUBufferUsage = {
    VERTEX: 32, INDEX: 16, UNIFORM: 64, COPY_DST: 8,
  };
});

const makeDevice = () => ({
  createShaderModule: vi.fn(() => ({})),
  createBindGroupLayout: vi.fn(() => ({})),
  createPipelineLayout: vi.fn(() => ({})),
  createRenderPipeline: vi.fn(() => ({ getBindGroupLayout: vi.fn(() => ({})) })),
  createBuffer: vi.fn((desc) => ({
    size: desc.size, destroy: vi.fn(), mapAsync: vi.fn(), getMappedRange: vi.fn(), unmap: vi.fn(),
  })),
  createBindGroup: vi.fn(() => ({})),
  queue: { writeBuffer: vi.fn() },
}) as unknown as GPUDevice;

describe('createBankDepthPipeline', () => {
  it('builds a straight-ribbon pipeline when no curve is supplied', () => {
    const d = makeDevice();
    const p = createBankDepthPipeline(d);
    expect(p.indexCount).toBeGreaterThan(0);
    expect(p.positions).toBeTruthy();
    expect(p.sides).toBeTruthy();
    expect(p.indices).toBeTruthy();
    p.dispose();
  });

  it('builds a longer vertex buffer when given a route curve', () => {
    const d = makeDevice();
    const curve = new RouteCurve(
      [vec3(0, 0, 0), vec3(0, 0, -500), vec3(0, 0, -1000)],
      false,
    );
    const p = createBankDepthPipeline(d, { curve });
    // 1 km route → defaultDivisions ≥ 100 → each strip has ≥ 100 columns × 2
    // verts × 2 strips → indices ≥ 100 × 6 × 2 = 1200.
    expect(p.indexCount).toBeGreaterThan(1200);
    p.dispose();
  });

  it('passes `edgesForProgress` through to the bank strip builder', () => {
    const d = makeDevice();
    const curve = new RouteCurve([vec3(0, 0, 0), vec3(0, 0, -200)], false);
    const edges = vi.fn(() => ({ left: 5, right: 25 }));
    const p = createBankDepthPipeline(d, { curve, edgesForProgress: edges });
    expect(edges).toHaveBeenCalled();
    p.dispose();
  });
});
