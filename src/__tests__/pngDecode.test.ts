import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { decodePng } from '../utils/pngDecode';

/**
 * Enough PNG to answer "is there anything in this picture". Hand-written for
 * the same reason the FIT encoder is: it is a small, fully specified format,
 * and the alternative is a dependency carried for one assertion.
 */
describe('decodePng', () => {
  it('decodes the shipped hero screenshot', () => {
    const file = fs.readFileSync(
      path.join(process.cwd(), 'docs/screenshot-rower-3d.png'),
    );

    const image = decodePng(file);

    expect(image.width).toBe(1214);
    expect(image.height).toBe(497);
    expect(image.pixels.length).toBe(1214 * 497 * 3);
  });

  it('rejects something that is not a PNG', () => {
    expect(() => decodePng(Buffer.from('definitely not a png'))).toThrow(/png/i);
  });

  it('produces plausible pixel values', () => {
    const file = fs.readFileSync(
      path.join(process.cwd(), 'docs/screenshot-rower-3d.png'),
    );

    const { pixels } = decodePng(file);

    expect(pixels.every((v) => v >= 0 && v <= 255)).toBe(true);
    // Not all one value — the image is at least a gradient.
    expect(new Set(pixels.slice(0, 30_000)).size).toBeGreaterThan(1);
  });
});
