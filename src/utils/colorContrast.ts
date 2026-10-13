// ============================================================================
// Chromatic apartness between two RGB samples.
//
// Lifted out of `playwright/tests/shipping-scene-contrast.spec.ts` so the
// shipping-scene spec and the #474 palette-contrast guard both read the same
// implementation. Changing one would otherwise drift silently against the
// other.
// ============================================================================

export type Rgb = readonly [number, number, number];

/**
 * How far one RGB sample is from another in a hue-aware sense.
 *
 * Each component is normalised against the sample's brightest channel, so a
 * dark red and a mid red are "close" (both red) and a dark red and a dark blue
 * are "apart" (same brightness, different hue). The output lies in [0, ~1.4];
 * the PR #465 water-vs-bank gate uses 0.05 as the chromatic-apart threshold.
 */
export const chromaticApart = (a: Rgb, b: Rgb): number => {
  const normalise = (sample: Rgb): Rgb => {
    const peak = Math.max(sample[0], sample[1], sample[2], 1);
    return [sample[0] / peak, sample[1] / peak, sample[2] / peak];
  };
  const na = normalise(a);
  const nb = normalise(b);
  const dr = na[0] - nb[0];
  const dg = na[1] - nb[1];
  const db = na[2] - nb[2];
  return Math.sqrt(dr * dr + dg * dg + db * db);
};

/** Parse `#RRGGBB` into `[0..255, 0..255, 0..255]`. Throws on malformed input. */
export const parseHexColor = (hex: string): Rgb => {
  const match = /^#?([0-9a-fA-F]{6})$/.exec(hex);
  if (!match) throw new Error(`Not a #RRGGBB hex colour: ${hex}`);
  const value = match[1];
  return [
    parseInt(value.slice(0, 2), 16),
    parseInt(value.slice(2, 4), 16),
    parseInt(value.slice(4, 6), 16),
  ];
};
