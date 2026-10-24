import { describe, expect, it } from 'vitest';
import {
  vec3,
  vec3Add,
  vec3Copy,
  vec3Cross,
  vec3Damp,
  vec3Distance,
  vec3DistanceSq,
  vec3Dot,
  vec3Length,
  vec3LengthSq,
  vec3Lerp,
  vec3Normalize,
  vec3Scale,
  vec3Set,
  vec3Sub,
} from '../vec3';

describe('vec3', () => {
  it('constructs and sets', () => {
    const v = vec3(1, 2, 3);
    expect([v[0], v[1], v[2]]).toEqual([1, 2, 3]);
    vec3Set(v, 4, 5, 6);
    expect([v[0], v[1], v[2]]).toEqual([4, 5, 6]);
  });

  it('copies, adds and subtracts', () => {
    const a = vec3(1, 2, 3);
    const b = vec3(4, 5, 6);
    const out = vec3();
    expect([...vec3Add(out, a, b)]).toEqual([5, 7, 9]);
    expect([...vec3Sub(out, b, a)]).toEqual([3, 3, 3]);
    expect([...vec3Copy(out, a)]).toEqual([1, 2, 3]);
  });

  it('scales, dots, and crosses', () => {
    const a = vec3(1, 0, 0);
    const b = vec3(0, 1, 0);
    const out = vec3();
    expect([...vec3Scale(out, a, 3)]).toEqual([3, 0, 0]);
    expect(vec3Dot(a, b)).toBe(0);
    expect([...vec3Cross(out, a, b)]).toEqual([0, 0, 1]);
  });

  it('measures length and normalises', () => {
    const a = vec3(3, 4, 0);
    expect(vec3LengthSq(a)).toBe(25);
    expect(vec3Length(a)).toBe(5);
    const out = vec3();
    vec3Normalize(out, a);
    expect(out[0]).toBeCloseTo(0.6);
    expect(out[1]).toBeCloseTo(0.8);
    // Zero vector normalises to zero without NaN.
    vec3Normalize(out, vec3(0, 0, 0));
    expect([...out]).toEqual([0, 0, 0]);
  });

  it('lerps and damps', () => {
    const out = vec3();
    vec3Lerp(out, vec3(0, 0, 0), vec3(10, 10, 10), 0.5);
    expect([...out]).toEqual([5, 5, 5]);

    const current = vec3(0, 0, 0);
    vec3Damp(current, current, vec3(10, 10, 10), 0.1, 1);
    // 1 - e^-10 ≈ 0.9999 — close to the target after a full second at tau=0.1.
    expect(current[0]).toBeGreaterThan(9.9);
    // tau <= 0 snaps to target.
    vec3Damp(current, current, vec3(1, 2, 3), 0, 1);
    expect([...current]).toEqual([1, 2, 3]);
  });

  it('measures distance', () => {
    expect(vec3DistanceSq(vec3(1, 2, 3), vec3(4, 6, 3))).toBe(25);
    expect(vec3Distance(vec3(1, 2, 3), vec3(4, 6, 3))).toBe(5);
  });
});
