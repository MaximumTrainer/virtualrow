import { describe, expect, it } from 'vitest';
import { RouteCurve } from '../curve';
import { vec3 } from '../vec3';

describe('RouteCurve', () => {
  it('samples a single-point curve', () => {
    const c = new RouteCurve([vec3(1, 2, 3)]);
    const s = c.sample(0.5);
    expect([s.position[0], s.position[1], s.position[2]]).toEqual([1, 2, 3]);
    expect(s.angle).toBe(0);
  });

  it('returns a sensible default on an empty curve', () => {
    const c = new RouteCurve([]);
    const s = c.sample(0.3);
    expect([...s.position]).toEqual([0, 0, 0]);
    expect(s.tangent[2]).toBe(-1);
  });

  it('samples position along a straight line', () => {
    const c = new RouteCurve([vec3(0, 0, 0), vec3(0, 0, -10)]);
    const s = c.sample(0.5);
    expect(s.position[2]).toBeCloseTo(-5, 1);
  });

  it('samples a closed loop by wrapping', () => {
    const c = new RouteCurve(
      [vec3(0, 0, 0), vec3(10, 0, 0), vec3(10, 0, -10), vec3(0, 0, -10)],
      true,
    );
    expect(c.length).toBe(4);
    const s = c.sample(1);
    // At t=1 we are back at the start of a closed loop.
    expect(Math.hypot(s.position[0], s.position[2])).toBeLessThan(0.1);
  });

  it('approximates the length of a straight segment', () => {
    const c = new RouteCurve([vec3(0, 0, 0), vec3(0, 0, -100)]);
    const len = c.approximateLength(32);
    expect(len).toBeGreaterThan(95);
    expect(len).toBeLessThan(105);
  });

  it('returns zero length when there is nothing to measure', () => {
    expect(new RouteCurve([]).approximateLength()).toBe(0);
    expect(new RouteCurve([vec3(0, 0, 0)]).approximateLength()).toBe(0);
  });

  it('clamps progress to [0, 1]', () => {
    const c = new RouteCurve([vec3(0, 0, 0), vec3(10, 0, 0)]);
    expect(c.sample(-1).position[0]).toBeLessThan(1);
    expect(c.sample(2).position[0]).toBeGreaterThan(9);
  });
});
