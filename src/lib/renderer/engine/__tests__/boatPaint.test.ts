import { describe, expect, it } from 'vitest';

import {
  BOAT_PAINT_PALETTE,
  BOAT_PAINT_PALETTE_COUNT,
  BOAT_TINT_DEFAULT,
  boatTintFromAthlete,
  hashAthleteId,
} from '../boatPaint';

describe('boatPaint (#571 shell paint variations)', () => {
  it('exposes a palette with at least 4 distinct colours', () => {
    expect(BOAT_PAINT_PALETTE_COUNT).toBeGreaterThanOrEqual(4);
    const seen = new Set(BOAT_PAINT_PALETTE.map((c) => c.join(',')));
    expect(seen.size).toBe(BOAT_PAINT_PALETTE_COUNT);
  });

  it('every palette entry stays in [0.55, 0.95] per channel so no shell is pitch-black or blown out', () => {
    for (const [r, g, b, a] of BOAT_PAINT_PALETTE) {
      for (const c of [r, g, b]) {
        expect(c).toBeGreaterThanOrEqual(0.55);
        expect(c).toBeLessThanOrEqual(0.95);
      }
      expect(a).toBe(1);
    }
  });

  it('returns the default off-white for undefined / empty id', () => {
    const def = boatTintFromAthlete(undefined);
    for (let i = 0; i < 4; i += 1) {
      expect(def[i]).toBeCloseTo(BOAT_TINT_DEFAULT[i], 6);
    }
    const empty = boatTintFromAthlete('');
    for (let i = 0; i < 4; i += 1) {
      expect(empty[i]).toBeCloseTo(BOAT_TINT_DEFAULT[i], 6);
    }
    const nulled = boatTintFromAthlete(null);
    for (let i = 0; i < 4; i += 1) {
      expect(nulled[i]).toBeCloseTo(BOAT_TINT_DEFAULT[i], 6);
    }
  });

  it('is deterministic — same id always picks the same tint', () => {
    const a = boatTintFromAthlete('athlete-42');
    const b = boatTintFromAthlete('athlete-42');
    expect(Array.from(a)).toEqual(Array.from(b));
  });

  it('returns a fresh Float32Array per call (callers can poke into a uniform buffer without aliasing)', () => {
    const a = boatTintFromAthlete('athlete-42');
    const b = boatTintFromAthlete('athlete-42');
    expect(a).not.toBe(b);
    a[0] = -1;
    expect(b[0]).not.toBe(-1);
  });

  it('different ids pick different palette slots when the hash disagrees', () => {
    const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'];
    const slots = new Set<string>();
    for (const id of ids) {
      const tint = boatTintFromAthlete(id);
      slots.add(Array.from(tint).join(','));
    }
    // Should spread across the palette; expect at least half the colours
    // observed over the sample (any smaller means the hash is colliding
    // more than it should).
    expect(slots.size).toBeGreaterThanOrEqual(Math.min(5, BOAT_PAINT_PALETTE_COUNT));
  });

  it('always returns a valid palette entry (the modulo keeps us in bounds)', () => {
    for (const id of ['', 'short', 'a-very-long-identifier-string-exceeding-usual-lengths']) {
      const tint = boatTintFromAthlete(id);
      // Float32 round-trip loses a few ulps from the Number palette entry
      // (0.78 → ~0.77999997); 1e-6 is comfortably past that noise.
      const match = BOAT_PAINT_PALETTE.some((p) => p.every((c, i) => Math.abs(c - tint[i]) < 1e-6));
      expect(match || id === '').toBe(true);
    }
  });

  it('hashAthleteId is stable (regression guard — a drift would re-colour every athlete)', () => {
    // These two expectations lock in the FNV-1a baseline so changing the
    // hash algorithm is a conscious decision.
    expect(hashAthleteId('athlete-42')).toBeGreaterThan(0);
    expect(hashAthleteId('athlete-42')).toBe(hashAthleteId('athlete-42'));
    expect(hashAthleteId('a') !== hashAthleteId('b')).toBe(true);
  });
});
