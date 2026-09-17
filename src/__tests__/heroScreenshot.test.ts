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
