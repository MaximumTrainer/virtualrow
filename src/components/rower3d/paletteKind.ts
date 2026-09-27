import * as THREE from 'three';

/**
 * Classify a scenery part's flat colour into a facade kind (#432).
 *
 * The scenery kit ships `baseColorFactor` per part and nothing else
 * (`public/assets/scenery/README.md` — "flat colour, no textures"), so there
 * are no names to hook a material rule to. What is there is the palette from
 * #216, and its groups fall into three shapes a building's outside can take:
 *
 * - **brick** — warm, saturated: hue < 30° and saturation > 0.3.
 * - **plaster** — bright, near-neutral: lightness > 0.8.
 * - **clapboard** — everything else, painted timber in cool or muted tones.
 *
 * Order matters. Brick catches the warm-saturated tones first so that a
 * light-sand plaster (`#e8d0a8`) is not misread as brick, and a
 * pale-cream (`#f0e8d0`) does not fall through to clapboard on its
 * high lightness alone.
 */

export type PaletteKind = 'brick' | 'plaster' | 'clapboard';

export const paletteKind = (color: THREE.Color): PaletteKind => {
  // A THREE.Color from a hex string stores its channels linearly, so a plain
  // `getHSL` reads darker than the palette was authored in. The hex the
  // scenery kit ships was written in sRGB (`README.md`: "per-face hex from
  // the issue palette"), so classify in that space.
  const hsl = { h: 0, s: 0, l: 0 };
  color.clone().convertLinearToSRGB().getHSL(hsl);

  const hueDeg = hsl.h * 360;
  if (hsl.s > 0.3 && (hueDeg < 30 || hueDeg > 340)) return 'brick';
  if (hsl.l > 0.8) return 'plaster';
  return 'clapboard';
};
