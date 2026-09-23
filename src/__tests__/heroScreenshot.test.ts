import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { decodePng } from '../utils/pngDecode';
import { isBlankImage, describeImageContent, type RgbImage } from '../utils/imageContent';

/**
 * The hero screenshot on the public site must show a rowing scene.
 *
 * docs/screenshot-rower-3d.png is served at
 * maximumtrainer.github.io/virtualrow/screenshot-rower-3d.png and is the first
 * thing a visitor sees. It is the baseline of the hero shot in
 * playwright/tests/visual/docs-screenshots.spec.ts (#362), recorded on CI's
 * SwiftShader job when a pull request carries the `visual-baseline` label.
 * The visual suite says whether the picture is still true; this file says
 * whether it is worth publishing. A blank one shipped once, because nothing
 * checked the result.
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

/**
 * The publishing gate for the hero, with a message that is a fault report.
 *
 * A refusal here is about the scene - framing (#328), foliage density (#333) -
 * and never a reason to move the floor: a faithful but dull hero is the
 * pipeline telling the truth.
 */
const expectPublishableHero = (image: RgbImage, file: string) => {
  const verdict = isBlankImage(image);
  const d = verdict.summary;

  expect(
    verdict.blank,
    `${file} is blank: ${verdict.reason}. ` +
      `colours=${d.uniqueColours} hEnergy=${d.horizontalEnergy.toFixed(3)} ` +
      `vEnergy=${d.verticalEnergy.toFixed(3)} dominant=${(d.dominantShare * 100).toFixed(1)}%. ` +
      'That is a fault in the scene being photographed, not in the threshold. ' +
      'Fix the scene, then re-record the docs baselines with the visual-baseline ' +
      'label (DEVELOPMENT.md, "Updating the published screenshots").',
  ).toBe(false);
};

/**
 * A grey image whose horizontal energy is `target` to three places.
 *
 * Each row is a distinct grey, so it has plenty of colours and no dominant one,
 * and its first `steps` pairs alternate by one level before the row goes
 * flat: every such step adds 1 to the horizontal sum. With 1001 columns there
 * are 1000 pairs a row, so `target * 1000` steps give exactly `target` - the
 * one measurement left to fail.
 */
const withHorizontalEnergy = (target: number): RgbImage => {
  const width = 1001;
  const height = 64;
  const steps = Math.round(target * (width - 1));
  const pixels = new Uint8Array(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const grey = 64 + y * 2 + (Math.min(x, steps) % 2);
      pixels.fill(grey, (y * width + x) * 3, (y * width + x) * 3 + 3);
    }
  }
  return { width, height, pixels };
};

describe('the published hero screenshot', () => {
  it('exists and is a readable PNG', () => {
    const image = load(HERO);

    expect(image.width).toBeGreaterThan(400);
    expect(image.height).toBeGreaterThan(200);
  });

  it('shows a rendered scene rather than an empty sky', () => {
    expectPublishableHero(load(HERO), HERO);
  });

  it('refuses a faithful but structureless hero by naming the measurement and the floor (#362)', () => {
    // The hero #362 regenerated against the #321 rescale: mostly open water
    // and a thin strip of trees, measuring 0.489 against a floor of 0.8. The
    // gate was right to refuse it, and the refusal is only actionable if it
    // says by how much.
    const structureless = withHorizontalEnergy(0.489);

    expect(describeImageContent(structureless).horizontalEnergy.toFixed(3)).toBe('0.489');
    expect(() => expectPublishableHero(structureless, 'a regenerated hero')).toThrow(
      /0\.489 < 0\.8\b/,
    );
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
