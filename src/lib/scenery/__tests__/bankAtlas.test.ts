import { describe, expect, it } from 'vitest';

import {
  BANK_ATLAS_SIZE,
  BANK_ATLAS_HALF,
  GRASS_U_OFFSET,
  EARTH_U_OFFSET,
  paintBankAtlas,
} from '../bankAtlas';

describe('paintBankAtlas (#591-fu P0b)', () => {
  it('exposes atlas layout constants the shader samples with', () => {
    expect(BANK_ATLAS_SIZE).toBe(128);
    expect(BANK_ATLAS_HALF).toBe(64);
    expect(GRASS_U_OFFSET).toBe(0);
    expect(EARTH_U_OFFSET).toBe(0.5);
  });

  it('produces 128×128 RGBA buffer with alpha 255 everywhere', () => {
    const pixels = paintBankAtlas();
    expect(pixels.length).toBe(BANK_ATLAS_SIZE * BANK_ATLAS_SIZE * 4);
    for (let i = 3; i < pixels.length; i += 4) expect(pixels[i]).toBe(255);
  });

  it('is deterministic', () => {
    expect(paintBankAtlas()).toEqual(paintBankAtlas());
  });

  it('grass half is dominantly green, earth half is dominantly warm', () => {
    const pixels = paintBankAtlas();
    const sampleRGBMean = (xStart: number, xEnd: number): [number, number, number] => {
      let r = 0, g = 0, b = 0, n = 0;
      for (let y = 0; y < BANK_ATLAS_SIZE; y += 1) {
        for (let x = xStart; x < xEnd; x += 1) {
          const i = (y * BANK_ATLAS_SIZE + x) * 4;
          r += pixels[i]; g += pixels[i + 1]; b += pixels[i + 2]; n += 1;
        }
      }
      return [r / n, g / n, b / n];
    };
    const [gR, gG, gB] = sampleRGBMean(0, BANK_ATLAS_HALF);
    const [eR, eG, eB] = sampleRGBMean(BANK_ATLAS_HALF, BANK_ATLAS_SIZE);
    // Grass: G > R > B (green dominant).
    expect(gG).toBeGreaterThan(gR);
    expect(gR).toBeGreaterThan(gB);
    // Earth: R > G > B (warm brown).
    expect(eR).toBeGreaterThan(eG);
    expect(eG).toBeGreaterThan(eB);
  });

  it('neither half is flat colour (noise + macro variation present)', () => {
    const pixels = paintBankAtlas();
    const uniqueR = new Set<number>();
    for (let y = 0; y < BANK_ATLAS_SIZE; y += 1) {
      for (let x = 0; x < BANK_ATLAS_SIZE; x += 1) {
        uniqueR.add(pixels[(y * BANK_ATLAS_SIZE + x) * 4]);
      }
    }
    expect(uniqueR.size).toBeGreaterThan(30);
  });
});
