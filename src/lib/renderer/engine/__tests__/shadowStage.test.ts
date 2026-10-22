import { describe, expect, it } from 'vitest';
import { makeMockDevice } from '../../__tests__/_mockWebGPU';
import { createShadowStage } from '../shadowStage';
import { createShadowAtlas } from '../shadowAtlas';
import { createInstancePool } from '../../plan/instancePools';
import { createBuildingPool, buildSmokeBuildings } from '../../plan/buildings';

const makeAtlasOnMock = (device: ReturnType<typeof makeMockDevice>) =>
  createShadowAtlas(device, 512, 2);

const emptyTelemetry = () => ({
  cascades: 0,
  atlasSize: 0,
  drawsPerCascade: 0,
  lastSplits: [] as number[],
  draws: 0,
  triangles: 0,
  atlasBytes: 0,
});

describe('shadowStage (#566 P6 — buildings cast through the same atlas)', () => {
  it('builds all three depth pipelines regardless of pool content', () => {
    const device = makeMockDevice();
    const atlas = makeAtlasOnMock(device);
    const stage = createShadowStage({
      device,
      atlas,
      scenePools: [],
      buildingsPool: null,
      telemetry: emptyTelemetry(),
    });
    expect(stage.bank).toBeDefined();
    expect(stage.scenery).toBeDefined();
    expect(stage.buildings).toBeDefined();
    stage.dispose();
  });

  it('is a no-op encode when the atlas has zero cascades armed', () => {
    const device = makeMockDevice();
    const atlas = makeAtlasOnMock(device);
    const stage = createShadowStage({
      device,
      atlas,
      scenePools: [],
      buildingsPool: null,
      telemetry: emptyTelemetry(),
    });
    // payload.cascadeCount defaults to 0.
    const ctx = {
      device,
      encoder: device.createCommandEncoder(),
      swapView: {} as GPUTextureView,
      depthView: {} as GPUTextureView,
      width: 1,
      height: 1,
      frame: {
        view: new Float32Array(16),
        proj: new Float32Array(16),
        viewProj: new Float32Array(16),
        camPos: new Float32Array(3),
        sunDir: new Float32Array(3),
        fog: new Float32Array(4),
        time: 0,
      } as unknown as import('../frameGraph').FrameUniforms,
      colorCleared: false,
      depthCleared: false,
    };
    stage.encode(ctx);
    expect(stage.telemetry.cascades).toBe(0);
    stage.dispose();
  });

  it('wires a charactersDepth path when a mesh + boat pass are passed in (#570 D7)', async () => {
    const device = makeMockDevice();
    const atlas = makeAtlasOnMock(device);
    const { buildBoatMesh } = await import('../../plan/boatMesh');
    const { createBoatPass } = await import('../../passes/boat');
    const frameUniforms = device.createBuffer({
      size: 256,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    const mesh = buildBoatMesh();
    const boatPass = createBoatPass({ device, format: 'bgra8unorm', frameUniforms, mesh });
    const stage = createShadowStage({
      device,
      atlas,
      scenePools: [],
      buildingsPool: null,
      charactersMesh: mesh,
      boatPass,
      telemetry: emptyTelemetry(),
    });
    expect(stage.characters).not.toBeNull();
    stage.dispose();
    boatPass.dispose();
  });

  it('skips the characters path when no mesh is passed (#570 D7-c basic/low)', () => {
    const device = makeMockDevice();
    const atlas = makeAtlasOnMock(device);
    const stage = createShadowStage({
      device,
      atlas,
      scenePools: [],
      buildingsPool: null,
      charactersMesh: null,
      boatPass: null,
      telemetry: emptyTelemetry(),
    });
    expect(stage.characters).toBeNull();
    stage.dispose();
  });

  it('accepts a buildings pool and includes it in the cast when armed', () => {
    const device = makeMockDevice();
    const atlas = makeAtlasOnMock(device);
    const pool = createInstancePool(device, {
      kind: 'foliage',
      speciesIndex: 0,
      chunkIndex: 0,
      positions: new Float32Array([0, 0, 0]),
      bounds: { cx: 0, cy: 0, cz: 0, radius: 1 },
    });
    const buildings = createBuildingPool(device, buildSmokeBuildings({ count: 3 }));
    const stage = createShadowStage({
      device,
      atlas,
      scenePools: [pool],
      buildingsPool: buildings,
      telemetry: emptyTelemetry(),
    });
    expect(stage.buildings).toBeDefined();
    stage.dispose();
    pool.dispose();
    buildings.dispose();
  });
});
