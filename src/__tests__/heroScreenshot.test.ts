import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { decodePng } from '../utils/pngDecode';
import { isBlankImage, describeImageContent } from '../utils/imageContent';

/**
 * The hero screenshot on the public site must show a rowing scene.
 *
 * docs/screenshot-rower-3d.png is served at
 * maximumtrainer.github.io/virtualrow/screenshot-rower-3d.png and is the first
 * thing a visitor sees. It is produced by the docs capture in
 * virtualrow.spec.ts, which writes whatever the canvas happens to hold — and
 * nothing checked the result, so a blank one shipped.
 *
 * These assertions are deliberately about content rather than existence: the
 * blank hero was a valid 1214x377 PNG with 343 distinct colours, so every
 * cheaper check passes it.
 */
const HERO = 'docs/screenshot-rower-3d.png';

/** Every screenshot the site publishes, not just the hero. */
const PUBLISHED = [
  'docs/screenshot-rower-3d.png',
  'docs/screenshot-activity.png',
  'docs/screenshot-route-selection.png',
];

const load = (relative: string) =>
  decodePng(fs.readFileSync(path.join(process.cwd(), relative)));

describe('the published hero screenshot', () => {
  it('exists and is a readable PNG', () => {
    const image = load(HERO);

    expect(image.width).toBeGreaterThan(400);
    expect(image.height).toBeGreaterThan(200);
  });

  it('shows a rendered scene rather than an empty sky', () => {
    const image = load(HERO);
    const verdict = isBlankImage(image);
    const d = verdict.summary;

    expect(
      verdict.blank,
      `${HERO} is blank: ${verdict.reason}. ` +
        `colours=${d.uniqueColours} hEnergy=${d.horizontalEnergy.toFixed(3)} ` +
        `vEnergy=${d.verticalEnergy.toFixed(3)} dominant=${(d.dominantShare * 100).toFixed(1)}%. ` +
        'Regenerate it with the docs capture in virtualrow.spec.ts against a ' +
        'renderer that actually draws the scene.',
    ).toBe(false);
  });
});

describe('every published screenshot', () => {
  for (const file of PUBLISHED) {
    it(`${file} shows something`, () => {
      const verdict = isBlankImage(load(file));

      expect(verdict.blank, `${file} is blank: ${verdict.reason}`).toBe(false);
    });
  }
});

describe('measurement, for the record', () => {
  it('reports what each published screenshot contains', () => {
    for (const file of PUBLISHED) {
      const d = describeImageContent(load(file));
      console.log(
        `${file}: colours=${d.uniqueColours} hEnergy=${d.horizontalEnergy.toFixed(3)} ` +
          `vEnergy=${d.verticalEnergy.toFixed(3)} dominant=${(d.dominantShare * 100).toFixed(1)}%`,
      );
    }
    expect(PUBLISHED.length).toBeGreaterThan(0);
  });
});

describe('the hero shows a river with two banks (#290)', () => {
  /**
   * The committed hero went on showing the defect #269 described - a green
   * bank on the left, sky-white where the right bank should be - for as long
   * as it took to notice by eye, because `isBlankImage` passes a picture with
   * a green half and a white half quite happily.
   *
   * This is what #269's third criterion asked for: the machinery in
   * imageContent.ts pointed at a band either side of the channel. Run over the
   * file that is actually published, so a stale or half-rendered hero cannot
   * sit in the repository unremarked.
   */
  /** Mean green-minus-red over a vertical slice: high on vegetation, ~0 on sky. */
  const greenness = (from: number, to: number): number => {
    const image = load(HERO);
    const x0 = Math.floor(from * image.width);
    const x1 = Math.floor(to * image.width);
    // The lower half only. Above the horizon is sky on both sides even when
    // the banks are drawn perfectly.
    const y0 = Math.floor(image.height * 0.5);

    let total = 0;
    let count = 0;
    for (let y = y0; y < image.height; y += 1) {
      for (let x = x0; x < x1; x += 1) {
        const i = (y * image.width + x) * 3;
        total += image.pixels[i + 1] - image.pixels[i];
        count += 1;
      }
    }
    return count ? total / count : 0;
  };

  it('has ground either side of the water, not sky on one side', () => {
    // The outer fifth of each side, below the horizon: where a bank is, and
    // where the channel is not.
    const left = greenness(0, 0.2);
    const right = greenness(0.8, 1);

    for (const [side, value] of [['left', left], ['right', right]] as const) {
      expect(
        value,
        `the ${side} of the hero reads as sky rather than ground ` +
          `(green minus red is ${value.toFixed(1)}; vegetation is tens, sky is nothing)`,
      ).toBeGreaterThan(10);
    }
  });
});
