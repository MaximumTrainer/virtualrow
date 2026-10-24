import { describe, expect, it } from 'vitest';
import { makeMockDevice } from '../../__tests__/_mockWebGPU';
import {
  createBuildingsDepthPipeline,
  createBuildingsDepthPoolBindGroup,
} from '../buildingsDepth';

describe('buildingsDepth (#566 FR4 / D4-a)', () => {
  it('builds a depth-only pipeline + two bind-group layouts', () => {
    const device = makeMockDevice();
    const pipeline = createBuildingsDepthPipeline(device);
    expect(pipeline.pipeline).toBeDefined();
    expect(pipeline.cascadeLayout).toBeDefined();
    expect(pipeline.poolLayout).toBeDefined();
    pipeline.dispose();
    pipeline.dispose(); // idempotent
  });

  it('makes a pool bind group that references both centres + sizes', () => {
    const device = makeMockDevice();
    const pipeline = createBuildingsDepthPipeline(device);
    const centresBuffer = device.createBuffer({ size: 16, usage: 0 });
    const sizesBuffer = device.createBuffer({ size: 16, usage: 0 });
    const bg = createBuildingsDepthPoolBindGroup(device, pipeline.poolLayout, {
      centresBuffer,
      sizesBuffer,
    });
    expect(bg).toBeDefined();
    pipeline.dispose();
  });
});
