import { describe, expect, it } from 'vitest';
import { createFrameGraph, type FrameUniforms, type Pass } from '../frameGraph';
import type { GpuFrameTimer } from '../gpuFrameTimer';
import { mat4 } from '../../math/mat4';
import { vec3 } from '../../math/vec3';
import { makeMockDevice } from '../../__tests__/_mockWebGPU';

const makePass = (name: string, calls: string[]): Pass => ({
  name,
  encode: () => calls.push(name),
  dispose: () => calls.push(`${name}:dispose`),
});

const frame = (): FrameUniforms => ({
  view: mat4(),
  proj: mat4(),
  viewProj: mat4(),
  camPos: vec3(),
  sunDir: vec3(0, 1, 0),
  fog: new Float32Array(4),
  time: 0,
});

describe('frameGraph', () => {
  it('runs passes in order and submits once per frame', () => {
    const device = makeMockDevice();
    const calls: string[] = [];
    const graph = createFrameGraph([
      makePass('sky', calls),
      makePass('bank', calls),
      makePass('water', calls),
    ]);
    const view = {} as GPUTextureView;
    const depth = {} as GPUTextureView;
    graph.run(device, view, depth, 10, 10, frame());
    expect(calls).toEqual(['sky', 'bank', 'water']);
    expect(device.__log.submits).toBe(1);
    graph.dispose();
    expect(calls).toContain('sky:dispose');
  });

  it('brackets the pass loop with the GPU timer and reads back after submit (#584 AC3)', () => {
    const device = makeMockDevice();
    const calls: string[] = [];
    const timer: GpuFrameTimer = {
      writeBegin: () => calls.push('timer:begin'),
      writeEnd: () => calls.push('timer:end'),
      resolve: () => calls.push('timer:resolve'),
      readback: () => calls.push('timer:readback'),
      gpuMs: 0,
      dispose: () => calls.push('timer:dispose'),
    };
    const graph = createFrameGraph([makePass('sky', calls), makePass('postfx', calls)], timer);
    graph.run(device, {} as GPUTextureView, {} as GPUTextureView, 10, 10, frame());
    // begin stamps before the first pass; end + resolve after the last pass
    // (both before submit); readback kicks after the single submit.
    expect(calls).toEqual([
      'timer:begin',
      'sky',
      'postfx',
      'timer:end',
      'timer:resolve',
      'timer:readback',
    ]);
    expect(device.__log.submits).toBe(1);
  });

  it('ignores runs after dispose', () => {
    const device = makeMockDevice();
    const calls: string[] = [];
    const graph = createFrameGraph([makePass('sky', calls)]);
    graph.dispose();
    graph.run(device, {} as GPUTextureView, {} as GPUTextureView, 1, 1, frame());
    expect(device.__log.submits).toBe(0);
    graph.dispose();
  });
});
