import { describe, expect, it } from 'vitest';
import {
  acesFilmic,
  brightPass,
  buildNeutralLutPixels,
  composite,
  gtaoLite,
  sampleLut,
  vignette,
  type Lut3D,
} from '../postFxMath';

const neutralLut: Lut3D = { pixels: buildNeutralLutPixels(32), size: 32 };

describe('postFxMath', () => {
  // #573 AC3 — ACES tone-map clamps linear HDR into display space; no RGB
  // channel exceeds 1.0 after tone-map, however bright the input.
  it('acesFilmic clamps bright inputs at or below 1 (AC3)', () => {
    const out = acesFilmic([10, 20, 30]);
    for (const v of out) expect(v).toBeLessThanOrEqual(1.0);
    for (const v of out) expect(v).toBeGreaterThanOrEqual(0);
  });

  it('acesFilmic keeps a mid-tone away from the clamp', () => {
    // A pre-tone-map scene whose sky dome overshoots 1.0 but not by much.
    // After ACES, the result stays within display range.
    const out = acesFilmic([1.4, 1.2, 0.9]);
    for (const v of out) expect(v).toBeLessThan(1.0);
  });

  it('acesFilmic preserves ordering of channels', () => {
    const out = acesFilmic([0.2, 0.5, 1.5]);
    expect(out[0]).toBeLessThan(out[1]);
    expect(out[1]).toBeLessThan(out[2]);
  });

  // #573 AC2 — the bright-pass threshold eats sub-threshold pixels so a
  // bloom pyramid built from them is close to zero. A bright texel passes
  // through with intensity > 0 at level 0.
  it('brightPass zeros a dim pixel and passes a bright one (AC2)', () => {
    const dim = brightPass([0.3, 0.3, 0.3]);
    const bright = brightPass([2.0, 2.0, 2.0]);
    expect(dim[0]).toBeLessThan(0.05);
    expect(bright[0]).toBeGreaterThan(0.1);
  });

  // #573 AC4 — identity LUT sample returns the input (within 8-bit precision).
  it('sampleLut identity LUT returns input (AC4)', () => {
    for (const rgb of [
      [0.1, 0.4, 0.9],
      [0.5, 0.5, 0.5],
      [0.0, 1.0, 0.5],
    ] as const) {
      const out = sampleLut(neutralLut, rgb);
      for (let i = 0; i < 3; i += 1) {
        expect(Math.abs(out[i] - rgb[i])).toBeLessThan(1.5 / 255);
      }
    }
  });

  // A swapped LUT (R↔G) applied to a known input must swap its channels on
  // output — the AC4 "shifted LUT produces the expected swap" case.
  it('sampleLut swapped LUT swaps R and G (AC4)', () => {
    const size = 32;
    const original = buildNeutralLutPixels(size);
    const swapped = new Uint8ClampedArray(original.length);
    swapped.set(original);
    for (let i = 0; i < swapped.length; i += 4) {
      const r = swapped[i];
      swapped[i] = swapped[i + 1];
      swapped[i + 1] = r;
    }
    const lut: Lut3D = { pixels: swapped, size };
    const out = sampleLut(lut, [1.0, 0.0, 0.5]);
    expect(out[0]).toBeLessThan(0.05); // red input, swapped to green channel: now 0
    expect(out[1]).toBeGreaterThan(0.95); // green now carries old red
  });

  it('vignette darkens corners vs centre (D5-a)', () => {
    const centre = vignette([0.5, 0.5], 0.5);
    const corner = vignette([0.95, 0.95], 0.5);
    expect(centre).toBeGreaterThan(corner);
    expect(centre).toBeCloseTo(1, 4);
    expect(corner).toBeLessThan(1);
  });

  it('composite + bloom brightens vs scene alone', () => {
    const scene = [0.4, 0.4, 0.4] as const;
    const noBloom = composite(scene, [0, 0, 0], neutralLut, [0.5, 0.5]);
    const withBloom = composite(scene, [1, 1, 1], neutralLut, [0.5, 0.5], { bloomStrength: 0.5 });
    for (let i = 0; i < 3; i += 1) {
      expect(withBloom[i]).toBeGreaterThan(noBloom[i]);
    }
  });

  // #573 AC5 — SSAO visibly darker in creases. A synthetic scene where the
  // horizon has pixels closer than centre casts occlusion, producing ao < 1.
  it('gtaoLite returns ao < 1 at a crease (AC5)', () => {
    const centreDepth = 0.9;
    const ao = gtaoLite(() => 0.5, centreDepth);
    expect(ao).toBeLessThan(1);
    expect(ao).toBeGreaterThanOrEqual(0);
  });

  it('gtaoLite returns 1 on a flat depth plane (AC5 negative)', () => {
    const ao = gtaoLite(() => 0.5, 0.5);
    expect(ao).toBeCloseTo(1, 4);
  });
});
