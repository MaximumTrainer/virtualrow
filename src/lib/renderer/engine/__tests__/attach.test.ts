import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { attach, isSceneryRoute } from '../attach';
import { resetWebGPUHealth } from '../health';
import {
  installGPUStub,
  makeMockAdapter,
  makeMockCanvas,
  makeMockGPU,
} from '../../__tests__/_mockWebGPU';
import { releaseTelemetry } from '../telemetry';
import { buildSmokeFoliagePools } from '../../plan/instancePools';

type WithTest = {
  _frameOnce: () => void;
  _telemetry: {
    frameStats: { frame: number };
    renderStats: { draws: number; sceneryDraws: number; sceneryDispatch: number };
    scenery: { pools: { kind: string; instanceCount: number }[]; dispatchCount: number; drawCount: number };
    foliage: { trees: number; meshes: number; drawn: number };
    contextState: { kind: string; backend: string };
  };
  dispose(): void;
};

beforeEach(() => {
  installGPUStub(makeMockGPU(makeMockAdapter()));
  resetWebGPUHealth();
});

afterEach(() => {
  installGPUStub(undefined);
  releaseTelemetry();
});

describe('attach', () => {
  it('returns null when WebGPU is unavailable', async () => {
    installGPUStub(undefined);
    const canvas = makeMockCanvas();
    const renderer = await attach(canvas);
    expect(renderer).toBeNull();
  });

  it('returns null on a software adapter', async () => {
    installGPUStub(makeMockGPU(makeMockAdapter({ software: true })));
    const canvas = makeMockCanvas();
    const renderer = await attach(canvas);
    expect(renderer).toBeNull();
  });

  it('mounts and draws one frame in testMode', async () => {
    const canvas = makeMockCanvas();
    const renderer = (await attach(canvas, { testMode: true })) as unknown as WithTest;
    expect(renderer).not.toBeNull();
    expect(canvas.getAttribute('data-backend')).toBe('webgpu');
    expect(renderer._telemetry.contextState.kind).toBe('ready');
    const before = renderer._telemetry.frameStats.frame;
    renderer._frameOnce();
    expect(renderer._telemetry.frameStats.frame).toBeGreaterThan(before);
    renderer.dispose();
    expect(canvas.getAttribute('data-backend')).toBeNull();
    // Disposing twice is a no-op.
    renderer.dispose();
  });

  it('surfaces renderer-unavailable when getContext returns null', async () => {
    const canvas = makeMockCanvas();
    (canvas as unknown as { getContext(): null }).getContext = () => null;
    const renderer = await attach(canvas);
    expect(renderer).toBeNull();
  });

  it('runs the full colour-pass graph on every frame', async () => {
    const canvas = makeMockCanvas();
    const renderer = (await attach(canvas, { testMode: true })) as unknown as WithTest;
    expect(renderer).not.toBeNull();
    renderer._frameOnce();
    // sky, clouds, bank, buildings, scenery, floraSolid, water, boat, sceneryMesh
    // (#566 added clouds + buildings on medium+; #570 added boat; #549 scenery
    // slice added sceneryMesh for GLB course furniture / structures).
    expect(renderer._telemetry.renderStats.draws).toBe(9);
    renderer.dispose();
  });

  it('wires scenery pools from a SceneryRoute', async () => {
    const canvas = makeMockCanvas();
    const pools = buildSmokeFoliagePools({ speciesCount: 2, chunkCount: 2, perChunk: 10 });
    const renderer = (await attach(canvas, {
      testMode: true,
      route: { pools },
    })) as unknown as WithTest;
    expect(renderer).not.toBeNull();
    expect(renderer._telemetry.scenery.pools.length).toBeGreaterThanOrEqual(4);
    expect(renderer._telemetry.scenery.dispatchCount).toBeGreaterThan(0);
    expect(renderer._telemetry.foliage.trees).toBe(2 * 2 * 10);
    expect(renderer._telemetry.foliage.meshes).toBe(4);
    renderer.dispose();
  });

  it('isSceneryRoute recognises the shape', () => {
    expect(isSceneryRoute({ pools: [] })).toBe(true);
    expect(isSceneryRoute(null)).toBe(false);
    expect(isSceneryRoute({})).toBe(false);
    expect(isSceneryRoute({ pools: 'not-an-array' })).toBe(false);
  });
});
