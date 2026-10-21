import { describe, expect, it } from 'vitest';
import { expectedAtlasBytes, highTierKtx2 } from '../engine/textureLoader';

describe('textureLoader', () => {
  it('highTierKtx2 selects KTX2 at high / extra-high only (#562 FR2)', () => {
    expect(highTierKtx2('high')).toBe(true);
    expect(highTierKtx2('extra-high')).toBe(true);
    expect(highTierKtx2('medium')).toBe(false);
    expect(highTierKtx2('low')).toBe(false);
    expect(highTierKtx2('basic')).toBe(false);
    expect(highTierKtx2(undefined)).toBe(false);
  });

  it('expectedAtlasBytes picks the BC7 and RGBA8 chains (AC3 #562)', () => {
    const { ktx2, uncompressed } = expectedAtlasBytes(512, 512);
    expect(ktx2).toBeGreaterThan(0);
    expect(uncompressed).toBeGreaterThan(0);
    // AC3: KTX2 is ~4× smaller than uncompressed.
    expect(uncompressed / ktx2).toBeGreaterThan(3.5);
  });
});
