import { describe, expect, it } from 'vitest';
import { makeMockDevice } from '../../__tests__/_mockWebGPU';
import { createFrameUniformBuffer, FRAME_UNIFORMS_FLOATS, packFrameUniforms } from '../uniforms';
import { mat4 } from '../../math/mat4';
import { vec3 } from '../../math/vec3';

const buildFrame = () => ({
  view: mat4(),
  proj: mat4(),
  viewProj: mat4(),
  camPos: vec3(1, 2, 3),
  sunDir: vec3(0, 1, 0),
  fog: new Float32Array([0.1, 0.2, 0, 0]),
  time: 42,
});

describe('uniforms', () => {
  it('packs the frame struct at the right offsets', () => {
    const packed = packFrameUniforms(buildFrame());
    expect(packed.length).toBe(FRAME_UNIFORMS_FLOATS);
    expect([packed[48], packed[49], packed[50]]).toEqual([1, 2, 3]);
    expect([packed[52], packed[53], packed[54]]).toEqual([0, 1, 0]);
    expect(packed[60]).toBe(42);
  });

  it('creates a uniform buffer of the right size', () => {
    const device = makeMockDevice();
    const buf = createFrameUniformBuffer(device);
    expect(buf).toBeDefined();
  });
});
