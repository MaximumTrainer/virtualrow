// ============================================================================
// A SMALL PNG DECODER
//
// Enough of the format to answer "is there anything in this picture" for the
// published hero screenshot, and no more: 8-bit RGB and RGBA, non-interlaced,
// which is what a browser screenshot produces.
//
// Hand-written for the same reason the FIT encoder is. The alternative is a
// dependency carried for one assertion, and the parts of PNG needed here — the
// signature, IHDR, concatenated IDAT through inflate, and the five scanline
// filters from the spec — are small and fully specified.
// ============================================================================

import zlib from 'node:zlib';
import type { RgbImage } from './imageContent';

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Bytes per pixel for the colour types this decoder accepts. */
const CHANNELS: Record<number, number> = { 2: 3, 6: 4 };

const paeth = (a: number, b: number, c: number): number => {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
};

/**
 * Decode a PNG to flat RGB triplets.
 *
 * Alpha is dropped rather than composited: the screenshots this reads are
 * opaque, and compositing against an assumed background would invent contrast
 * that is not in the file — which is the exact thing being measured.
 */
export const decodePng = (file: Buffer): RgbImage => {
  if (file.length < 8 || !file.subarray(0, 8).equals(SIGNATURE)) {
    throw new Error('not a PNG: bad signature');
  }

  const width = file.readUInt32BE(16);
  const height = file.readUInt32BE(20);
  const bitDepth = file[24];
  const colourType = file[25];
  const interlace = file[28];

  if (bitDepth !== 8) throw new Error(`unsupported PNG bit depth ${bitDepth}`);
  if (interlace !== 0) throw new Error('unsupported interlaced PNG');
  const channels = CHANNELS[colourType];
  if (!channels) throw new Error(`unsupported PNG colour type ${colourType}`);

  const chunks: Buffer[] = [];
  let offset = 8;
  while (offset + 8 <= file.length) {
    const length = file.readUInt32BE(offset);
    const type = file.toString('ascii', offset + 4, offset + 8);
    if (type === 'IDAT') chunks.push(file.subarray(offset + 8, offset + 8 + length));
    if (type === 'IEND') break;
    offset += 12 + length;
  }
  if (chunks.length === 0) throw new Error('not a PNG: no image data');

  const raw = zlib.inflateSync(Buffer.concat(chunks));
  const stride = width * channels;
  const out = new Uint8Array(width * height * 3);

  let previous = new Uint8Array(stride);
  let read = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = raw[read];
    read += 1;
    const line = raw.subarray(read, read + stride);
    read += stride;

    const current = new Uint8Array(stride);
    for (let i = 0; i < stride; i += 1) {
      const left = i >= channels ? current[i - channels] : 0;
      const up = previous[i];
      const upLeft = i >= channels ? previous[i - channels] : 0;
      let value = line[i];
      switch (filter) {
        case 0: break;
        case 1: value += left; break;
        case 2: value += up; break;
        case 3: value += (left + up) >> 1; break;
        case 4: value += paeth(left, up, upLeft); break;
        default: throw new Error(`unknown PNG filter ${filter} on row ${y}`);
      }
      current[i] = value & 0xff;
    }

    for (let x = 0; x < width; x += 1) {
      const from = x * channels;
      const to = (y * width + x) * 3;
      out[to] = current[from];
      out[to + 1] = current[from + 1];
      out[to + 2] = current[from + 2];
    }
    previous = current;
  }

  return { width, height, pixels: out };
};
