import { describe, it, expect } from 'vitest';
import { seededRandom } from '../components/rower3d/helpers';

describe('seededRandom', () => {
  it('returns a value in [0, 1)', () => {
    for (let i = 0; i < 100; i++) {
      const val = seededRandom(i);
      expect(val).toBeGreaterThanOrEqual(0);
      expect(val).toBeLessThan(1);
    }
  });

  it('is deterministic — same seed always yields same value', () => {
    expect(seededRandom(42)).toBe(seededRandom(42));
    expect(seededRandom(0)).toBe(seededRandom(0));
    expect(seededRandom(9999)).toBe(seededRandom(9999));
  });

  it('produces different values for different seeds', () => {
    const vals = new Set([seededRandom(1), seededRandom(2), seededRandom(3), seededRandom(100)]);
    expect(vals.size).toBe(4);
  });

  it('handles negative seeds', () => {
    const val = seededRandom(-5);
    expect(val).toBeGreaterThanOrEqual(0);
    expect(val).toBeLessThan(1);
  });
});
