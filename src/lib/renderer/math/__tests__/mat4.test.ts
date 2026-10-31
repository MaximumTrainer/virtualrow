import { describe, expect, it } from 'vitest';
import {
  mat4,
  mat4Copy,
  mat4FromRotationZ,
  mat4Identity,
  mat4LookAt,
  mat4Multiply,
  mat4Perspective,
} from '../mat4';
import { vec3 } from '../vec3';

describe('mat4FromRotationZ (#571 boat roll axis)', () => {
  it('maps (1, 0, 0) to (0, 1, 0) at +π/2 (right-hand rule about +Z)', () => {
    const m = mat4FromRotationZ(mat4(), Math.PI / 2);
    // Column-major: m applied to (1,0,0,1) via m[col*4+row].
    const x = m[0] * 1 + m[4] * 0 + m[8] * 0;
    const y = m[1] * 1 + m[5] * 0 + m[9] * 0;
    const z = m[2] * 1 + m[6] * 0 + m[10] * 0;
    expect(x).toBeCloseTo(0, 10);
    expect(y).toBeCloseTo(1, 10);
    expect(z).toBeCloseTo(0, 10);
  });

  it('leaves +Z unchanged (the rotation axis)', () => {
    const m = mat4FromRotationZ(mat4(), 0.7);
    const x = m[0] * 0 + m[4] * 0 + m[8] * 1;
    const y = m[1] * 0 + m[5] * 0 + m[9] * 1;
    const z = m[2] * 0 + m[6] * 0 + m[10] * 1;
    expect(x).toBeCloseTo(0, 10);
    expect(y).toBeCloseTo(0, 10);
    expect(z).toBeCloseTo(1, 10);
  });

  it('is identity at angle 0', () => {
    const m = mat4FromRotationZ(mat4(), 0);
    expect([m[0], m[5], m[10], m[15]]).toEqual([1, 1, 1, 1]);
    // sin(0) can be ±0 depending on the FPU; both are "no rotation".
    for (const idx of [1, 2, 4, 6, 8, 9]) {
      expect(Math.abs(m[idx]!)).toBe(0);
    }
  });
});

describe('mat4', () => {
  it('constructs identity', () => {
    const m = mat4();
    expect([m[0], m[5], m[10], m[15]]).toEqual([1, 1, 1, 1]);
    expect(m[1]).toBe(0);
  });

  it('resets to identity and copies', () => {
    const m = mat4();
    m[3] = 7;
    mat4Identity(m);
    expect(m[3]).toBe(0);
    const other = mat4();
    other[0] = 42;
    mat4Copy(m, other);
    expect(m[0]).toBe(42);
  });

  it('builds a perspective matrix', () => {
    const m = mat4();
    mat4Perspective(m, Math.PI / 2, 1, 1, 100);
    // f/aspect at the corner.
    expect(m[0]).toBeCloseTo(1);
    expect(m[5]).toBeCloseTo(1);
    expect(m[11]).toBe(-1);
    expect(m[15]).toBe(0);
  });

  it('looks at a point', () => {
    const m = mat4();
    mat4LookAt(m, vec3(0, 0, 10), vec3(0, 0, 0), vec3(0, 1, 0));
    // Looking down -Z puts the forward on the -Z axis; translation is -eye.
    expect(m[14]).toBeCloseTo(-10);
  });

  it('multiplies', () => {
    const a = mat4();
    const b = mat4();
    const out = mat4();
    // Identity * identity = identity.
    mat4Multiply(out, a, b);
    expect(out[0]).toBe(1);
    expect(out[5]).toBe(1);
    expect(out[10]).toBe(1);
    expect(out[15]).toBe(1);
  });
});
