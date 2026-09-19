import * as THREE from 'three';

// ============================================================================
// A SURFACE FOR THE RIVERBANK (#292)
//
// The banks were a flat field of one colour: a MeshPhysicalMaterial with no map
// of any kind, over a strip two vertices wide. Issue #269 asked for ground
// distinct from the water "in colour and texture", and only the colour half was
// done — which showed up as a measurement rather than an opinion, when a
// correctly rendered hero scored 0.795 for horizontal structure against a floor
// of 0.8 because two thirds of the frame was unbroken green.
//
// Generated rather than shipped as a file. It is mottling, not detail: a rower
// sees the bank at a glancing angle from a moving boat, and an asset would be
// another request on a route that already fetches a hundred and thirty models.
// ============================================================================

/** Texture edge, in pixels. Small on purpose — see the note above. */
export const BANK_TEXTURE_SIZE = 64;

/**
 * How far the mottling strays from white.
 *
 * `map` multiplies the material colour, so this shades each theme's own bank
 * rather than repainting it. Enough to break the wash up, not enough to read as
 * a pattern.
 */
const CONTRAST = 0.18;

/** A deterministic hash in 0..1. The scene must not shimmer between runs. */
const noiseAt = (x: number, y: number): number => {
  const h = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return h - Math.floor(h);
};

/** Smoothed value noise, so the result is ground rather than static. */
const smoothNoise = (x: number, y: number, scale: number): number => {
  const sx = x / scale;
  const sy = y / scale;
  const x0 = Math.floor(sx);
  const y0 = Math.floor(sy);
  const fx = sx - x0;
  const fy = sy - y0;

  // Smoothstep, so the cells blend instead of showing their edges.
  const ease = (t: number) => t * t * (3 - 2 * t);
  const ex = ease(fx);
  const ey = ease(fy);

  const topLeft = noiseAt(x0, y0);
  const topRight = noiseAt(x0 + 1, y0);
  const bottomLeft = noiseAt(x0, y0 + 1);
  const bottomRight = noiseAt(x0 + 1, y0 + 1);

  const top = topLeft + (topRight - topLeft) * ex;
  const bottom = bottomLeft + (bottomRight - bottomLeft) * ex;
  return top + (bottom - top) * ey;
};

/**
 * A tiling greyscale mottle for the riverbank.
 *
 * Two octaves: a broad one that gives the bank patches, and a finer one that
 * keeps it from looking like a blur when the boat passes close.
 */
export const createBankTexture = (): THREE.DataTexture => {
  const size = BANK_TEXTURE_SIZE;
  const data = new Uint8Array(size * size * 4);

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const broad = smoothNoise(x, y, 16);
      const fine = smoothNoise(x, y, 5);
      const mottle = broad * 0.7 + fine * 0.3;

      // Centred on white and pulled down by at most CONTRAST.
      const shade = 1 - CONTRAST * mottle;
      const value = Math.round(Math.max(0, Math.min(1, shade)) * 255);

      const i = (y * size + x) * 4;
      data[i] = value;
      data[i + 1] = value;
      data[i + 2] = value;
      data[i + 3] = 255;
    }
  }

  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  // The bank's UVs already run 0..1 across and t*10 along, so the along-route
  // axis tiles on its own; this spreads the mottle across the bank as well.
  texture.repeat.set(6, 1);
  texture.needsUpdate = true;
  return texture;
};
