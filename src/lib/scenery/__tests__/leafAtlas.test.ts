import { describe, expect, it } from 'vitest';

import {
  LEAF_ATLAS_SIZE,
  LEAF_ATLAS_SPECIES_COUNT,
  LEAF_ATLAS_COLUMN_WIDTH,
  paintLeafAtlas,
} from '../leafAtlas';

describe('paintLeafAtlas (#591-fu P1a)', () => {
  it('exposes the atlas layout constants the shader samples with', () => {
    expect(LEAF_ATLAS_SIZE).toBe(128);
    expect(LEAF_ATLAS_SPECIES_COUNT).toBe(3);
    expect(LEAF_ATLAS_COLUMN_WIDTH).toBe(42);
  });

  it('produces an RGBA buffer of the right size', () => {
    const pixels = paintLeafAtlas();
    expect(pixels.length).toBe(LEAF_ATLAS_SIZE * LEAF_ATLAS_SIZE * 4);
  });

  it('alpha carries the leaf silhouette — some pixels low, some high', () => {
    const pixels = paintLeafAtlas();
    let low = 0, high = 0;
    for (let i = 3; i < pixels.length; i += 4) {
      if (pixels[i] < 150) low += 1;
      else high += 1;
    }
    // Both bins should have real counts — alpha varies between leaf
    // clusters (high) and gaps (low).
    expect(low).toBeGreaterThan(1000);
    expect(high).toBeGreaterThan(1000);
  });

  it('is deterministic', () => {
    expect(paintLeafAtlas()).toEqual(paintLeafAtlas());
  });

  it('three species columns paint distinct patterns', () => {
    const pixels = paintLeafAtlas();
    const colMean = (col: number): [number, number] => {
      let r = 0, a = 0, n = 0;
      const xStart = col * LEAF_ATLAS_COLUMN_WIDTH;
      const xEnd = col === 2 ? LEAF_ATLAS_SIZE : (col + 1) * LEAF_ATLAS_COLUMN_WIDTH;
      for (let y = 0; y < LEAF_ATLAS_SIZE; y += 1) {
        for (let x = xStart; x < xEnd; x += 1) {
          const i = (y * LEAF_ATLAS_SIZE + x) * 4;
          r += pixels[i];
          a += pixels[i + 3];
          n += 1;
        }
      }
      return [r / n, a / n];
    };
    const [r0, a0] = colMean(0);
    const [r1, a1] = colMean(1);
    const [r2, a2] = colMean(2);
    // Not asking for a specific ordering — just that the three columns
    // don't collapse into one shared pattern.
    const distinct = (ra: number, rb: number, aa: number, ab: number): boolean =>
      Math.abs(ra - rb) > 2 || Math.abs(aa - ab) > 4;
    expect(distinct(r0, r1, a0, a1)).toBe(true);
    expect(distinct(r1, r2, a1, a2)).toBe(true);
    expect(distinct(r0, r2, a0, a2)).toBe(true);
  });
});
