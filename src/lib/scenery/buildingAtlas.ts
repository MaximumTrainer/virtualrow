/**
 * Procedural wall + roof texture atlas for the buildings pass (#591-fu P0a).
 *
 * The Biketerra reference used a single shared albedo atlas across every
 * building — one 128×128 texture carries both a brick/stone WALL region
 * (left half) and a tile ROOF region (right half). The shader samples the
 * right half for roof fragments and the left half for everything else, so
 * walls get a brick stagger with a dark mortar grid and roofs get horizontal
 * tile courses — small enough that the atlas uploads in a single
 * `writeTexture` call and keeps the memory cost under 64 KB, big enough for
 * mip 0 to resolve brick-sized features at ride-view distance.
 *
 * Palette tinting still happens at the fragment shader (per-profile
 * `PALETTE_WALL` / `PALETTE_ROOF` in `buildings.wgsl`): the atlas is a
 * neutral grey that reads as `albedo * tint`, so a residential biome paints
 * the same bricks warm sandstone and an industrial one paints them cool
 * grey without touching this file.
 *
 * All drawing is pixel-stamped in TypeScript so the asset path never leaves
 * the main bundle — no PNG round-trip, no DOM `<canvas>`, no asset server
 * dependency. Deterministic and tiny.
 */

/** Side length of the atlas in texels. The two regions share this edge. */
export const BUILDING_ATLAS_SIZE = 128;
/** Half the atlas edge — the point where the wall region ends and the roof region begins. */
export const BUILDING_ATLAS_HALF = BUILDING_ATLAS_SIZE / 2;

/** Which half of the atlas carries each pattern. UVs offset in the shader. */
export const WALL_U_OFFSET = 0;
export const ROOF_U_OFFSET = 0.5;

const clamp8 = (v: number): number => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v));

const putPixel = (pixels: Uint8Array, size: number, x: number, y: number, r: number, g: number, b: number, a = 255): void => {
  if (x < 0 || y < 0 || x >= size || y >= size) return;
  const i = (y * size + x) * 4;
  pixels[i] = clamp8(r);
  pixels[i + 1] = clamp8(g);
  pixels[i + 2] = clamp8(b);
  pixels[i + 3] = a;
};

/** Deterministic 1D hash → [0, 1). Byte-identical across runs. */
const h = (n: number): number => {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
};

/**
 * Paint a brick-stagger pattern over `size × size` texels, left-anchored at
 * x0. Each row shifts by half a brick width so vertical mortar lines don't
 * stack. Rows carry a mild per-brick lightness noise so a wall doesn't read
 * as a repeating stamp at camera-close distance.
 *
 * Returns nothing — writes into `pixels` in place.
 */
const paintBrick = (
  pixels: Uint8Array,
  size: number,
  x0: number,
  width: number,
  brickW: number,
  brickH: number,
): void => {
  const base = 200; // mid-grey; palette tints multiply this
  const mortar = 130;
  for (let y = 0; y < size; y += 1) {
    const row = Math.floor(y / brickH);
    const stagger = (row % 2) * (brickW / 2);
    const inMortarRow = y % brickH < 2; // 2-texel-thick horizontal mortar
    // #591-fu P1 (buildings colour variety): a dark horizontal "window
    // course" every ~20 texels — reads as a stripe of windows at building
    // scale, breaking a long wall out of a flat brick stamp.
    const windowBandY = y % 20;
    const inWindowBand = windowBandY > 7 && windowBandY < 13;
    for (let x = 0; x < width; x += 1) {
      const localX = (x + stagger) % brickW;
      const inMortarCol = localX < 2;
      if (inMortarRow || inMortarCol) {
        putPixel(pixels, size, x0 + x, y, mortar, mortar * 0.98, mortar * 0.9);
        continue;
      }
      // Per-brick seed from (row, column) so adjacent bricks differ.
      const col = Math.floor((x + stagger) / brickW);
      const n = (h(row * 73 + col * 19) - 0.5) * 30;
      if (inWindowBand) {
        // Window pane: dark rectangle every two bricks, with a highlight
        // on the frame edge. The horizontal band + per-pane spacing read
        // as windows at ride-view distance.
        const paneSlot = Math.floor(((x + stagger) % (brickW * 2)) / brickW);
        const inPane = paneSlot === 0 && localX > 1 && localX < brickW - 1;
        if (inPane) {
          const pane = 70 + h(col * 29 + row * 53) * 25;
          putPixel(pixels, size, x0 + x, y, pane, pane * 1.05, pane * 1.15);
          continue;
        }
      }
      const r = base + n * 1.05;
      const g = base + n * 1.0;
      const b = base + n * 0.9;
      putPixel(pixels, size, x0 + x, y, r, g, b);
    }
  }
};

/**
 * Paint horizontal tile courses over `size × size` texels, right-anchored at
 * x0. Each course is `tileH` tall; alternating courses offset the tile
 * seams horizontally so the roof doesn't read as a grid. Per-tile hash
 * jitter keeps the pattern lively.
 */
const paintRoofTiles = (
  pixels: Uint8Array,
  size: number,
  x0: number,
  width: number,
  tileW: number,
  tileH: number,
): void => {
  const base = 190;
  const seam = 110;
  for (let y = 0; y < size; y += 1) {
    const course = Math.floor(y / tileH);
    const seamRow = y % tileH < 1 || y % tileH === tileH - 1; // thin seam between courses
    const stagger = (course % 2) * (tileW / 2);
    for (let x = 0; x < width; x += 1) {
      const localX = (x + stagger) % tileW;
      const seamCol = localX < 1;
      if (seamRow || seamCol) {
        putPixel(pixels, size, x0 + x, y, seam, seam * 0.95, seam * 0.85);
        continue;
      }
      // Tile centre is lighter, edges darker — gives a subtle ridge-and-valley
      // feel without a normal map. `uRel` goes 0..1 across each tile.
      const uRel = localX / tileW;
      const vRel = (y % tileH) / tileH;
      const ridge = 1.0 - Math.abs(uRel * 2 - 1); // 1 at centre, 0 at edges
      const n = (h(course * 41 + Math.floor((x + stagger) / tileW) * 7) - 0.5) * 24;
      const tint = base + ridge * 20 - (1 - vRel) * 10 + n;
      putPixel(pixels, size, x0 + x, y, tint * 1.05, tint * 0.9, tint * 0.78);
    }
  }
};

/**
 * Build the atlas as raw RGBA pixels. Row-major, top row first, alpha = 255
 * everywhere. The texture upload step wraps this in an `rgba8unorm-srgb`
 * GPU texture; the shader samples with `addressModeU/V = repeat` so each
 * half of the atlas tiles across the wall / roof it covers.
 */
export const paintBuildingAtlas = (size = BUILDING_ATLAS_SIZE): Uint8Array => {
  const pixels = new Uint8Array(size * size * 4);
  const half = Math.floor(size / 2);
  // Walls on the LEFT half, roofs on the RIGHT. Brick width 10, height 6.
  paintBrick(pixels, size, 0, half, 10, 6);
  paintRoofTiles(pixels, size, half, half, 12, 8);
  return pixels;
};
