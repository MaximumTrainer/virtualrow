import { describe, expect, it } from 'vitest';
import { quat, quatFromAxisAngle, quatIdentity, quatNormalize } from '../quat';

describe('quat', () => {
  it('constructs identity', () => {
    const q = quat();
    expect([q[0], q[1], q[2], q[3]]).toEqual([0, 0, 0, 1]);
  });

  it('resets to identity', () => {
    const q = quat(1, 2, 3, 4);
    quatIdentity(q);
    expect([q[0], q[3]]).toEqual([0, 1]);
  });

  it('builds from axis-angle', () => {
    const q = quat();
    quatFromAxisAngle(q, 0, 1, 0, Math.PI);
    expect(q[1]).toBeCloseTo(1);
    expect(q[3]).toBeCloseTo(0, 5);
  });

  it('normalises', () => {
    const q = quat(2, 0, 0, 0);
    quatNormalize(q, q);
    expect(q[0]).toBeCloseTo(1);
    // Zero quaternion falls back to identity rather than NaN.
    const z = quat(0, 0, 0, 0);
    quatNormalize(z, z);
    expect([z[0], z[3]]).toEqual([0, 1]);
  });
});
