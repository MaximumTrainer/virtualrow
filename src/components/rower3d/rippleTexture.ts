import * as THREE from 'three';
import { CHOP_WAVELENGTH_METRES, RIPPLE_TILE_METRES } from './waterMaterial';

// ============================================================================
// THE CHOP (#324)
//
// The water's metre-scale detail, as a tiling normal map rather than as
// geometry. `waterMaterial.ts` says why: the channel is a two-vertex-wide
// ribbon sampled every 15 m, so a 1.5 m wave cannot exist in its vertices. It
// can exist per-pixel, and per-pixel is where a rower sees it anyway.
//
// `createWaterNormalMap` in `helpers.ts` already made something like this, and
// it was only ever used by `PhotorealisticWater` — the straight-route surface
// a real route never mounts. It is also a single `sin`/`cos` grid, which reads
// as corduroy. This sums several wavelengths at several angles, which is what
// makes a surface look disturbed rather than ruled.
// ============================================================================

/** Edge of the tile, in pixels. */
export const RIPPLE_TEXTURE_SIZE = 128;

/**
 * The chop, as directional waves: wavelength in metres, direction in radians,
 * and a height that falls with the wavelength the way real wind chop does.
 */
const RIPPLE_WAVES = [
  { metres: 6.0, angle: 0.0, height: 1.0 },
  { metres: 3.5, angle: 1.1, height: 0.7 },
  { metres: 2.2, angle: 2.3, height: 0.45 },
  { metres: 1.5, angle: 0.6, height: 0.3 },
] as const;

/**
 * A tiling normal map of wind chop, covering `RIPPLE_TILE_METRES` square.
 *
 * Wavelengths are rounded to a whole number of cycles per tile, because a
 * tiling texture whose waves do not close at the edge shows its seams — a grid
 * of them, right across the river.
 *
 * Returns null where there is no 2D context to draw into, as the shoreline and
 * wake textures do: water without ripples is a worse river, and water that
 * throws is no river at all.
 */
export const createRippleNormalMap = (
  size = RIPPLE_TEXTURE_SIZE,
): THREE.CanvasTexture | null => {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;

  const context = canvas.getContext('2d');
  if (!context) return null;

  const image = context.createImageData(size, size);
  const waves = RIPPLE_WAVES.map(({ metres, angle, height }) => ({
    // Whole cycles per tile, so the pattern closes on itself.
    cycles: Math.max(1, Math.round(RIPPLE_TILE_METRES / metres)),
    dx: Math.cos(angle),
    dy: Math.sin(angle),
    height,
  }));
  const totalHeight = waves.reduce((sum, wave) => sum + wave.height, 0);

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      // The surface gradient, summed over the waves: the normal of a height
      // field is (-dh/dx, -dh/dy, 1), so the slopes are what is needed, not
      // the heights.
      let slopeX = 0;
      let slopeY = 0;

      for (const wave of waves) {
        const phase =
          ((x / size) * wave.dx + (y / size) * wave.dy) * wave.cycles * Math.PI * 2;
        const slope = Math.cos(phase) * wave.height * wave.cycles;
        slopeX += slope * wave.dx;
        slopeY += slope * wave.dy;
      }

      const normal = new THREE.Vector3(
        -slopeX / totalHeight,
        -slopeY / totalHeight,
        1,
      ).normalize();

      const i = (y * size + x) * 4;
      // Packed the way three reads a tangent-space normal map: 0.5 is flat.
      image.data[i] = Math.round((normal.x * 0.5 + 0.5) * 255);
      image.data[i + 1] = Math.round((normal.y * 0.5 + 0.5) * 255);
      image.data[i + 2] = Math.round((normal.z * 0.5 + 0.5) * 255);
      image.data[i + 3] = 255;
    }
  }

  context.putImageData(image, 0, 0);

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  // A normal map holds directions, not colour. Tagged as sRGB it would be
  // gamma-decoded on the way in and every slope would come out wrong.
  texture.colorSpace = THREE.NoColorSpace;
  return texture;
};

/** The chop wavelengths this texture actually carries, in metres. */
export const rippleWavelengthsMetres = (): number[] =>
  RIPPLE_WAVES.map(({ metres }) => RIPPLE_TILE_METRES / Math.max(1, Math.round(RIPPLE_TILE_METRES / metres)));

/** The range the issue asked for, for a test to hold this texture to. */
export const RIPPLE_WAVELENGTH_RANGE_METRES = CHOP_WAVELENGTH_METRES;
