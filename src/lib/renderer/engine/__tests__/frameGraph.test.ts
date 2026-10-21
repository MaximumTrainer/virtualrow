import { describe, expect, it } from 'vitest';
import { createFrameGraph, type FrameUniforms, type Pass } from '../frameGraph';
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
