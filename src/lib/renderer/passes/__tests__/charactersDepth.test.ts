import { describe, expect, it } from 'vitest';
import { makeMockDevice } from '../../__tests__/_mockWebGPU';
import { createCharactersDepthPipeline } from '../charactersDepth';
import { buildBoatMesh } from '../../plan/boatMesh';

describe('charactersDepth pipeline (#570 FR8 / D7)', () => {
  it('builds a depth pipeline from the boat mesh buffers', () => {
    const device = makeMockDevice();
    const mesh = buildBoatMesh();
    const pipeline = createCharactersDepthPipeline(device, mesh);
    expect(pipeline.pipeline).toBeDefined();
    expect(pipeline.positions).toBeDefined();
    expect(pipeline.indices).toBeDefined();
    expect(pipeline.indexCount).toBe(mesh.indexCount);
    expect(pipeline.cascadeLayout).toBeDefined();
    expect(pipeline.drawLayout).toBeDefined();
    pipeline.dispose();
  });

  it('is safe to dispose twice', () => {
    const device = makeMockDevice();
    const mesh = buildBoatMesh();
    const pipeline = createCharactersDepthPipeline(device, mesh);
    pipeline.dispose();
    expect(() => pipeline.dispose()).not.toThrow();
  });
});
