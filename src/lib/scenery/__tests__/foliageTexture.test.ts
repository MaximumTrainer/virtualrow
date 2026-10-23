import { describe, expect, it } from 'vitest';
import { paintFoliage, FOLIAGE_SHAPES, type FoliageShape } from '../foliageTexture';
import { paintFoliage as reactPaintFoliage } from '../../../components/rower3d/foliageTexture';

describe('paintFoliage parity with React', () => {
  for (const shape of FOLIAGE_SHAPES) {
    it(`matches the React port byte-for-byte for ${shape}`, () => {
      const ours = paintFoliage(shape, 32);
      const theirs = reactPaintFoliage(shape as FoliageShape, 32);
      expect(ours.length).toBe(theirs.length);
      for (let i = 0; i < ours.length; i += 1) {
        expect(ours[i]).toBe(theirs[i]);
      }
    });
  }

  it('returns a 256×256 RGBA buffer for a full-size texture', () => {
    const bytes = paintFoliage('broadleaf', 256);
    expect(bytes.length).toBe(256 * 256 * 4);
  });

  it('produces non-trivial silhouettes (some pixels fully opaque)', () => {
    for (const shape of FOLIAGE_SHAPES) {
      const bytes = paintFoliage(shape, 64);
      let opaqueCount = 0;
      for (let i = 3; i < bytes.length; i += 4) if (bytes[i] >= 250) opaqueCount += 1;
      expect(opaqueCount).toBeGreaterThan(0);
    }
  });
});
