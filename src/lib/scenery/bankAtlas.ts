/**
 * Shared bank-surface albedo atlas for the bank pass (#591-fu P0b).
 *
 * The React scene's `bankTriplanar.glsl` samples two triplanar textures —
 * grass and earth — then blends them by surface slope and distance to the
 * water edge. The WebGPU bank is a flat strip, so slope is a constant, but
 * the distance-to-water blend is what gives Biketerra's lakeside its
 * characteristic look: lush damp grass at the mid-band, dry sandy earth
 * right at the shore. We pack both textures into one 128×128 atlas (grass
 * on the LEFT half, earth on the RIGHT) and sample twice in the shader,
 * mixing by a shore-distance factor. One shared atlas = one GPU texture
 * for every bank mesh, same trick as the building atlas.
 *
 * All drawing is pixel-stamped in TypeScript — deterministic, no DOM
 * canvas, no asset round-trip — matching `buildingAtlas.ts` so the two
 * atlases evolve in step.
 */

export const BANK_ATLAS_SIZE = 128;
export const BANK_ATLAS_HALF = BANK_ATLAS_SIZE / 2;

export const GRASS_U_OFFSET = 0;
export const EARTH_U_OFFSET = 0.5;

const clamp8 = (v: number): number => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v));
const put = (p: Uint8Array, size: number, x: number, y: number, r: number, g: number, b: number): void => {
  if (x < 0 || y < 0 || x >= size || y >= size) return;
  const i = (y * size + x) * 4;
  p[i] = clamp8(r); p[i + 1] = clamp8(g); p[i + 2] = clamp8(b); p[i + 3] = 255;
};

const h = (n: number): number => {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
};

/**
 * Grass tile — mid-saturation green mottled with a dark/light noise, with a
 * few darker "clumps" to break up a uniform field. Reads as damp grass at
 * ride-view distance; the shader multiplies by a biome palette so wetland
 * stays lush and farmland reads drier.
 */
const paintGrass = (p: Uint8Array, size: number, x0: number, width: number): void => {
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < width; x += 1) {
      // Base green with a two-octave noise so the field has large patches
      // AND fine blade-scale granularity.
      const macro = h(Math.floor((x + x0) / 6) * 73 + Math.floor(y / 6) * 37);
      const micro = h((x + x0) * 11 + y * 17);
      const n = macro * 0.65 + micro * 0.35;
      // Shift between a dry-ish tan-green (low n) and a lush bright green
      // (high n). Mortar-ish darker clumps every 32px add a "shaded tuft".
      const clump = ((x + x0) % 32 < 3 && y % 32 < 3) ? 0.6 : 1.0;
      const base = 110 + n * 60;
      put(p, size, x0 + x, y, base * 0.75 * clump, (base + 15) * clump, base * 0.55 * clump);
    }
  }
};

/**
 * Earth tile — warm brown/sand with pebble-sized spots and a mild dry-crack
 * cross-hatch. Reads as bare earth near the waterline where the grass thins.
 */
const paintEarth = (p: Uint8Array, size: number, x0: number, width: number): void => {
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const macro = h(Math.floor((x + x0) / 8) * 61 + Math.floor(y / 8) * 29);
      const micro = h((x + x0) * 7 + y * 13);
      const n = macro * 0.55 + micro * 0.45;
      // Thin cracks every 24 px at a shallow angle so earth doesn't look
      // like perfectly tiled wallpaper.
      const crackLo = ((x + x0 + Math.floor(y * 0.3)) % 24) < 1;
      const crack = crackLo ? 0.72 : 1.0;
      const base = 140 + n * 50;
      put(p, size, x0 + x, y, base * 1.05 * crack, base * 0.9 * crack, base * 0.65 * crack);
    }
  }
};

/**
 * Build the atlas as raw RGBA pixels. The bank pass creates one `rgba8unorm-
 * srgb` texture from this and samples twice per fragment (one grass UV, one
 * earth UV), then mixes by shore distance.
 */
export const paintBankAtlas = (size = BANK_ATLAS_SIZE): Uint8Array => {
  const pixels = new Uint8Array(size * size * 4);
  const half = Math.floor(size / 2);
  paintGrass(pixels, size, 0, half);
  paintEarth(pixels, size, half, half);
  return pixels;
};
