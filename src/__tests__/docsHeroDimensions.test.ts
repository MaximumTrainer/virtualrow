import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

/**
 * The site must reserve the shape the picture actually is.
 *
 * `docs/index.html` declared the hero as `width="1280" height="720"`. The file
 * is 1214x377 — the hero is clipped to `.activity-route-stage`'s bounding box
 * by the docs capture in virtualrow.spec.ts, so its shape is whatever the stage
 * happens to be, and 16:9 was never going to be it.
 *
 * An `<img>`'s width/height attributes are a presentational hint, so with
 * `.hero-screenshot img` setting `width` and never `height`, the 720 won.
 * Measured against the committed page, the hero rendered 720px tall at every
 * viewport width:
 *
 *   1440px wide -> 1100x720, a 1.53 ratio against the picture's 3.22
 *    900px wide ->  810x720, 1.13
 *    480px wide ->  432x720, 0.60 — a wide river smeared into a portrait box
 *
 * The CSS fix is `height: auto`, which stops an attribute dictating height ever
 * again. This test is the other half: the declared shape has to match the file,
 * or the space reserved while the image loads is the wrong shape and the page
 * jumps when it arrives.
 *
 * Ratio rather than exact pixels, because a proportional declaration — 640x360
 * for a 1280x720 thumbnail — reserves the right shape and is perfectly valid.
 */

const PAGE = path.join(process.cwd(), 'docs/index.html');

/** Width and height from a PNG's IHDR, without decoding the pixels. */
const pngSize = (file: string): { width: number; height: number } => {
  const head = fs.readFileSync(file).subarray(0, 24);
  if (head.subarray(0, 8).toString('binary') !== '\x89PNG\r\n\x1a\n') {
    throw new Error(`${file} is not a PNG`);
  }
  return { width: head.readUInt32BE(16), height: head.readUInt32BE(20) };
};

interface Declared {
  src: string;
  width: number;
  height: number;
}

/** Every local PNG the page declares a size for. */
const declaredImages = (): Declared[] => {
  const html = fs.readFileSync(PAGE, 'utf8');
  const found: Declared[] = [];
  for (const tag of html.match(/<img\b[^>]*>/g) ?? []) {
    const src = /\bsrc="([^"]+)"/.exec(tag)?.[1];
    const width = /\bwidth="(\d+)"/.exec(tag)?.[1];
    const height = /\bheight="(\d+)"/.exec(tag)?.[1];
    if (!src || !width || !height) continue;
    if (!src.endsWith('.png') || src.startsWith('http')) continue;
    found.push({ src, width: Number(width), height: Number(height) });
  }
  return found;
};

describe('the docs page declares the shape its pictures really are', () => {
  it('finds the images it is meant to be checking', () => {
    // A regex that quietly matched nothing would make every assertion below
    // vacuous, which is the failure mode this whole suite exists to avoid.
    expect(declaredImages().length).toBeGreaterThan(2);
  });

  for (const image of declaredImages()) {
    it(`${image.src} is declared with the aspect ratio of the file`, () => {
      const file = pngSize(path.join(process.cwd(), 'docs', image.src));
      const declared = image.width / image.height;
      const actual = file.width / file.height;

      expect(
        declared,
        `${image.src} is declared ${image.width}x${image.height} (${declared.toFixed(3)}) ` +
          `but the file is ${file.width}x${file.height} (${actual.toFixed(3)}). ` +
          'The browser reserves the declared shape while the image loads, and an ' +
          '<img> width/height attribute is a presentational hint that wins wherever ' +
          'the CSS does not set that dimension.',
      ).toBeCloseTo(actual, 2);
    });
  }
});

describe('the hero cannot be stretched by an attribute', () => {
  it('sets height: auto on the hero image', () => {
    const html = fs.readFileSync(PAGE, 'utf8');
    const rule = /\.hero-screenshot img \{([^}]*)\}/.exec(html)?.[1] ?? '';

    expect(rule, '.hero-screenshot img has no rule at all').not.toBe('');
    expect(
      rule.replace(/\s+/g, ' '),
      'without height: auto, the height="..." attribute sets a literal pixel ' +
        'height and the picture is stretched to it at every viewport width',
    ).toContain('height: auto');
  });
});
