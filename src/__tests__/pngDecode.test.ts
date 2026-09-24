import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { decodePng } from '../utils/pngDecode';

/**
 * Enough PNG to answer "is there anything in this picture". Hand-written for
 * the same reason the FIT encoder is: it is a small, fully specified format,
 * and the alternative is a dependency carried for one assertion.
 */
/**
 * The width and height in the file's own IHDR, read without the decoder.
 *
 * The PNG header is fixed: an 8-byte signature, then the IHDR chunk's length
 * and type, then width and height as big-endian 32-bit integers at offsets 16
 * and 20. Reading them here gives the decoder something to be checked against
 * that is not a number typed into this file.
 *
 * It used to be `expect(image.height).toBe(377)`, which is the hero's shape
 * rather than anything about decoding, and which failed the moment #335 gave
 * the stage the space the stats panel used to take. A re-recorded baseline is
 * not a decoder regression.
 */
const headerDimensions = (file: Buffer) => ({
  width: file.readUInt32BE(16),
  height: file.readUInt32BE(20),
});

describe('decodePng', () => {
  it('decodes the shipped hero screenshot', () => {
    const file = fs.readFileSync(
      path.join(process.cwd(), 'docs/screenshot-rower-3d.png'),
    );

    const image = decodePng(file);
    const header = headerDimensions(file);

    expect(image.width).toBe(header.width);
    expect(image.height).toBe(header.height);
    // Three bytes a pixel, and every one of them present: a decoder that
    // stopped early would still report the right dimensions.
    expect(image.pixels.length).toBe(header.width * header.height * 3);
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
