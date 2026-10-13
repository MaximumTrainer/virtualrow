import { describe, expect, it } from 'vitest';
import {
  TOP_PALETTE,
  SHORTS_PALETTE,
  SHOES_PALETTE,
  HAIR_PALETTE,
} from '../components/rower3d/rowerAppearance';
import { chromaticApart, parseHexColor } from '../utils/colorContrast';

/**
 * The shipping-scene water sample `shipping-scene-contrast.spec.ts` samples
 * at the `high` tier is a muted blue-grey. A clothing colour that lands at
 * that same spot would blur into the water in the frame — exactly what the
 * PR #465 chromaticApart gate catches on the bank. We hold the clothing
 * palette to a looser version of the same test: every palette entry must be
 * at least `CHROMATIC_MIN` apart from the water sample, so no slot can be
 * picked and silently vanish against the surface.
 */
const WATER_SAMPLE: [number, number, number] = [95, 115, 125];
const CHROMATIC_MIN = 0.05;

const paletteCases: ReadonlyArray<[string, readonly { id: string; hex: string }[]]> = [
  ['top', TOP_PALETTE],
  ['shorts', SHORTS_PALETTE],
  ['shoes', SHOES_PALETTE],
  ['hair', HAIR_PALETTE],
];

describe('rower appearance palette — chromatic contrast against water', () => {
  for (const [name, palette] of paletteCases) {
    it(`${name} palette entries clear the water sample`, () => {
      for (const option of palette) {
        const sample = parseHexColor(option.hex);
        const distance = chromaticApart(sample, WATER_SAMPLE);
        expect(distance, `${name}.${option.id} = ${option.hex}`).toBeGreaterThanOrEqual(
          CHROMATIC_MIN,
        );
      }
    });
  }

  it('every palette entry has a hex colour', () => {
    for (const [, palette] of paletteCases) {
      for (const option of palette) {
        expect(option.hex).toMatch(/^#[0-9A-Fa-f]{6}$/);
      }
    }
  });
});
