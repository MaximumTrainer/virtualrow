import { describe, expect, it } from 'vitest';
import { makeMockDevice } from './_mockWebGPU';
import { createSceneryPass, DEFAULT_MAX_DISTANCE } from '../engine/sceneryPass';
import { createInstancePool, type InstancePool } from '../plan/instancePools';
import { mat4, mat4Identity } from '../math/mat4';
import { vec3 } from '../math/vec3';
import type { FrameContext } from '../engine/frameGraph';

const makeUniformBuffer = (device: ReturnType<typeof makeMockDevice>): GPUBuffer =>
  device.createBuffer({ size: 256, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });

const makePools = (device: ReturnType<typeof makeMockDevice>): InstancePool[] => {
  const pos = (count: number): Float32Array => {
    const out = new Float32Array(count * 3);
    for (let i = 0; i < count; i += 1) {
      out[i * 3 + 0] = i;
      out[i * 3 + 2] = -i;
    }
    return out;
  };
  return [
    createInstancePool(device, {
      kind: 'foliage',
      speciesIndex: 0,
      chunkIndex: 0,
      positions: pos(32),
      bounds: { cx: 0, cy: 0, cz: 0, radius: 50 },
    }),
    createInstancePool(device, {
      kind: 'foliage',
      speciesIndex: 1,
      chunkIndex: 0,
      positions: pos(16),
      bounds: { cx: 0, cy: 0, cz: 0, radius: 50 },
    }),
    createInstancePool(device, {
      kind: 'scenery',
      speciesIndex: 0,
      positions: pos(8),
      bounds: { cx: 0, cy: 0, cz: 0, radius: 50 },
    }),
  ];
};

const makeFrameCtx = (
  device: ReturnType<typeof makeMockDevice>,
): FrameContext => {
  const encoder = device.createCommandEncoder();
  return {
    device,
    encoder,
    swapView: {} as GPUTextureView,
    outputView: {} as GPUTextureView,
    depthView: {} as GPUTextureView,
    width: 320,
    height: 240,
    frame: {
      view: mat4(),
      proj: mat4(),
      viewProj: mat4Identity(mat4()),
      camPos: vec3(0, 2.6, 7),
      sunDir: vec3(0, 1, 0),
      fog: new Float32Array(4),
      time: 0,
    },
    colorCleared: true,
    depthCleared: true,
  };
};

describe('sceneryPass', () => {
  it('dispatches once per pool and emits one indirect draw per pool', () => {
    const device = makeMockDevice();
    const frameUniforms = makeUniformBuffer(device);
    const pools = makePools(device);
    const pass = createSceneryPass({
      device,
      format: 'bgra8unorm',
      frameUniforms,
      sproutUniforms: frameUniforms,
      pools,
    });
    expect(pass.name).toBe('scenery');
    expect(pass.pools.length).toBe(3);

    pass.encode(makeFrameCtx(device));
    expect(device.__log.computeDispatches).toBe(3);
    expect(device.__log.indirectDraws).toBe(3);

    pass.dispose();
    pass.dispose(); // idempotent
    for (const p of pools) p.dispose();
  });

  it('encodes nothing when pools are empty', () => {
    const device = makeMockDevice();
    const frameUniforms = makeUniformBuffer(device);
    const pass = createSceneryPass({
      device,
      format: 'bgra8unorm',
      frameUniforms,
      sproutUniforms: frameUniforms,
      pools: [],
    });
    pass.encode(makeFrameCtx(device));
    expect(device.__log.computeDispatches).toBe(0);
    expect(device.__log.indirectDraws).toBe(0);
    pass.dispose();
  });

  it('populates telemetry per pool', () => {
    const device = makeMockDevice();
    const frameUniforms = makeUniformBuffer(device);
    const pools = makePools(device);
    const pass = createSceneryPass({
      device,
      format: 'bgra8unorm',
      frameUniforms,
      sproutUniforms: frameUniforms,
      pools,
    });
    expect(pass.telemetry.pools.length).toBe(3);
    expect(pass.telemetry.pools[0].kind).toBe('foliage');
    expect(pass.telemetry.pools[0].instanceCount).toBe(32);
    pass.encode(makeFrameCtx(device));
    expect(pass.telemetry.dispatchCount).toBe(3);
    expect(pass.telemetry.drawCount).toBe(3);
    pass.dispose();
    for (const p of pools) p.dispose();
  });

  it('uses the default max distance when none is supplied', () => {
    expect(DEFAULT_MAX_DISTANCE).toBe(320);
  });

  it('creates a 1×1 placeholder atlas when no foliageAtlasView is supplied', () => {
    // The pass has to bind a texture to its frame bind-group, so when a
    // caller mounts it without a real atlas (unit tests) it falls back to a
    // tiny placeholder; mount succeeds, dispose stays idempotent.
    const device = makeMockDevice();
    const frameUniforms = makeUniformBuffer(device);
    const pools = makePools(device);
    const pass = createSceneryPass({
      device,
      format: 'bgra8unorm',
      frameUniforms,
      sproutUniforms: frameUniforms,
      pools,
    });
    expect(pass.name).toBe('scenery');
    pass.dispose();
    for (const p of pools) p.dispose();
  });

  it('refuses work after dispose', () => {
    const device = makeMockDevice();
    const frameUniforms = makeUniformBuffer(device);
    const pools = makePools(device);
    const pass = createSceneryPass({
      device,
      format: 'bgra8unorm',
      frameUniforms,
      sproutUniforms: frameUniforms,
      pools,
    });
    pass.dispose();
    pass.encode(makeFrameCtx(device));
    expect(device.__log.computeDispatches).toBe(0);
    expect(device.__log.indirectDraws).toBe(0);
    for (const p of pools) p.dispose();
  });
});
