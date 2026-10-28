/**
 * Per-species leaf detail atlas for the solid flora pass (#591-fu P1a).
 *
 * The cone-stack trees from the follow-up (species 0-2) read as flat
 * palette-coloured geometry at ride-view distance because the fragment
 * shader paints each cone layer a single shade from `BASE_PAL`/`CROWN_PAL`.
 * Biketerra's trees read lusher because their crowns carry a texture that
 * breaks the silhouette into bright highlights and shadow pockets — a
 * sun-side lit top and a shaded underside, with foliage-scale noise all
 * over.
 *
 * This atlas packs three species's leaf-detail tiles side by side (one
 * column per species, each 42 texels wide × 128 tall) into a single
 * 128×128 `rgba8unorm-srgb` texture. The shader samples by
 * `(species-column + fract(angle), fract(crownHeight))` so the pattern
 * wraps smoothly around each cone without a visible seam, and the
 * fragment multiplies the atlas texel against the per-species crown
 * palette — no palette change, just a per-pixel brightness modulator.
 *
 * Alpha carries a leaf-cluster silhouette the shader uses as a soft
 * discard: fragments where `alpha < 0.5` darken to the shaded-under-
 * canopy palette, so a tree's silhouette softens at the edges instead
 * of reading as a crisp cone. No alpha-test on the pipeline, so the
 * foliage still writes depth and the fade is a smooth blend.
 */

export const LEAF_ATLAS_SIZE = 128;
export const LEAF_ATLAS_SPECIES_COUNT = 3;
export const LEAF_ATLAS_COLUMN_WIDTH = Math.floor(LEAF_ATLAS_SIZE / LEAF_ATLAS_SPECIES_COUNT);

const clamp8 = (v: number): number => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v));
const put = (p: Uint8Array, size: number, x: number, y: number, r: number, g: number, b: number, a: number): void => {
  if (x < 0 || y < 0 || x >= size || y >= size) return;
  const i = (y * size + x) * 4;
  p[i] = clamp8(r); p[i + 1] = clamp8(g); p[i + 2] = clamp8(b); p[i + 3] = clamp8(a);
};

const h = (n: number): number => {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
};

/**
 * Build one species's leaf column. `kind` selects the leaf-cluster shape:
 *   broadleaf → round lumpy clusters (oak / birch)
 *   conifer   → downward-pointing tufts (pine / fir)
 *   willow    → long thin streaks (willow / weeping)
 */
const paintSpecies = (
  pixels: Uint8Array,
  size: number,
  x0: number,
  width: number,
  kind: 'broadleaf' | 'conifer' | 'willow',
  seed: number,
): void => {
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < width; x += 1) {
      // Two-octave noise so leaves have a cluster scale AND a leaf-sized
      // detail inside each cluster.
      const u = x / width;
      const v = y / size;
      const macro = h(seed + Math.floor(u * 6) * 73 + Math.floor(v * 10) * 37);
      const micro = h(seed * 7 + x * 11 + y * 13);
      // Base intensity: lighter where the macro noise peaks, darker in
      // the valleys. Multiplied against the palette in the shader.
      let base: number;
      let alpha: number;
      switch (kind) {
        case 'broadleaf': {
          // Round lumpy clusters: alpha reads 1 inside blobs, falls off at
          // their edges. `clusterR` controls the blob radius.
          const clusterR = 0.5 - macro * 0.25;
          const cx = Math.floor(u * 4) / 4 + 0.125;
          const cy = Math.floor(v * 6) / 6 + 0.083;
          const d = Math.hypot(u - cx, v - cy);
          const inside = d < clusterR * 0.5;
          alpha = inside ? 230 + (micro - 0.5) * 50 : 90 + micro * 60;
          base = inside ? 190 + macro * 50 - micro * 30 : 140 + micro * 40;
          break;
        }
        case 'conifer': {
          // Downward-pointing tufts: alpha spikes along slanted "needles",
          // reads as needle clusters at distance. The slant breaks the
          // horizontal mortar look.
          const needle = Math.abs(u - 0.5) * 2.0 + v * 0.3;
          const inNeedle = needle < 0.75 && micro > 0.3;
          alpha = inNeedle ? 220 + (micro - 0.5) * 50 : 100 + macro * 60;
          base = inNeedle ? 170 + macro * 60 - micro * 20 : 130 + micro * 40;
          break;
        }
        case 'willow':
        default: {
          // Long thin streaks: willow reads with a drooping silhouette, so
          // the alpha channel runs in vertical fingers that go dark at the
          // bottom.
          const streak = ((Math.floor(u * 10) + Math.floor(v * 5)) % 3 === 0) && macro > 0.35;
          const droop = Math.pow(v, 1.4);
          alpha = streak ? 210 + (micro - 0.5) * 60 : 110 + macro * 50;
          base = streak ? 200 + macro * 40 - droop * 30 : 150 + micro * 30;
          break;
        }
      }
      put(pixels, size, x0 + x, y, base, base, base, alpha);
    }
  }
};

/**
 * Build the leaf atlas as raw RGBA pixels. Species order mirrors the
 * `BASE_PAL`/`CROWN_PAL` arrays in `floraSolid.wgsl`:
 *   0 = broadleaf, 1 = conifer, 2 = willow.
 * Species 3 (reed) and 4 (rock) ride the same shader but don't read the
 * leaf atlas (their crown is a thin blade / rock prism, not foliage).
 */
export const paintLeafAtlas = (size = LEAF_ATLAS_SIZE): Uint8Array => {
  const pixels = new Uint8Array(size * size * 4);
  const colW = Math.floor(size / LEAF_ATLAS_SPECIES_COUNT);
  paintSpecies(pixels, size, 0, colW, 'broadleaf', 101);
  paintSpecies(pixels, size, colW, colW, 'conifer', 211);
  paintSpecies(pixels, size, colW * 2, size - colW * 2, 'willow', 317);
  return pixels;
};
