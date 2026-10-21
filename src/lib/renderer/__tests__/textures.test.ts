import { describe, expect, it } from 'vitest';
import { mipLevelCountFor, textureBytes } from '../engine/textures';

describe('textures', () => {
  it('mipLevelCountFor rounds down log2(max)', () => {
    expect(mipLevelCountFor(1, 1)).toBe(1);
    expect(mipLevelCountFor(512, 512)).toBe(10);
    expect(mipLevelCountFor(512, 256)).toBe(10);
    expect(mipLevelCountFor(1024, 1)).toBe(11);
  });

  it('textureBytes for rgba8unorm-srgb sums rgba bytes per level', () => {
    // 512×512 with full mip chain → sum of 4·w·h.
    const bytes = textureBytes(512, 512, 'rgba8unorm-srgb', 10);
    expect(bytes).toBe(4 * (512 * 512 + 256 * 256 + 128 * 128 + 64 * 64 + 32 * 32 + 16 * 16 + 8 * 8 + 4 * 4 + 2 * 2 + 1));
  });

  it('textureBytes for BC7 sums block layout per level', () => {
    const bytes = textureBytes(512, 512, 'bc7-rgba-unorm-srgb', 10);
    // 512/4 × 512/4 × 16 for level 0 = 65536; chain is 65536, 16384, ...
    let expected = 0;
    let w = 512;
    let h = 512;
    for (let i = 0; i < 10; i += 1) {
      expected += Math.ceil(w / 4) * Math.ceil(h / 4) * 16;
      w = Math.max(1, Math.floor(w / 2));
      h = Math.max(1, Math.floor(h / 2));
    }
    expect(bytes).toBe(expected);
  });

  it('BC7 is roughly ~4× smaller than RGBA8 at matched size (AC3 #562)', () => {
    const rgba = textureBytes(512, 512, 'rgba8unorm-srgb', 10);
    const bc7 = textureBytes(512, 512, 'bc7-rgba-unorm-srgb', 10);
    expect(rgba / bc7).toBeGreaterThan(3.9);
    expect(rgba / bc7).toBeLessThan(4.1);
  });
});
