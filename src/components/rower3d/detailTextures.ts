import * as THREE from 'three';

// ============================================================================
// DETAIL TEXTURES FOR THE BOAT AND CREW (#354)
//
// The crewed GLB ships a flat `baseColorFactor` per part and nothing else, so
// a hull the same colour as a sheet of paper looks like one. These are small
// tiling normal maps drawn into a canvas, so no download is needed and jsdom
// can build them for a test.
//
// Cached by kind: `MeshPhysicalMaterial` holds a reference to the texture it
// samples, and a fresh instance per scull would allocate megabytes on every
// mount. Every caller of `carbonWeaveNormalMap()` gets the same texture; the
// textures live for the lifetime of the process.
// ============================================================================

const TEXTURE_SIZE = 128;

const cache = new Map<string, THREE.CanvasTexture>();

/** Only for tests: forget the cached textures. */
export const resetDetailTexturesForTesting = (): void => {
  for (const texture of cache.values()) texture.dispose();
  cache.clear();
};

const buildCanvas = (
  size: number,
  draw: (ctx: CanvasRenderingContext2D, size: number) => void,
): HTMLCanvasElement | null => {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  draw(ctx, size);
  return canvas;
};

const asRepeatingTexture = (canvas: HTMLCanvasElement): THREE.CanvasTexture => {
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.needsUpdate = true;
  return texture;
};

/**
 * A tiling normal map of woven carbon at roughly 4 mm.
 *
 * Two interleaved diagonal ridges: a real 2×2 twill has a warp going one way
 * and a weft going the other, and the eye reads the checkerboard of highlights
 * that comes off it as carbon rather than as painted stripes.
 *
 * Encoded in tangent space: the neutral blue `#8080ff` is "surface faces
 * straight up", and the red/green channels push the sample sideways where the
 * weave sits proud of it.
 */
export const carbonWeaveNormalMap = (): THREE.CanvasTexture | null => {
  const cached = cache.get('carbon');
  if (cached) return cached;
  const canvas = buildCanvas(TEXTURE_SIZE, (ctx, size) => {
    const img = ctx.createImageData(size, size);
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        // 8-pixel tiles: a 2×2 twill repeats every four warp+weft crossings.
        const warp = Math.sin(((x + y) / 4) * Math.PI);
        const weft = Math.sin(((x - y) / 4) * Math.PI);
        // Push R for the +x tilt of the ridge, G for the +y tilt.
        const r = 128 + Math.round(warp * 40);
        const g = 128 + Math.round(weft * 40);
        const b = 255;
        const i = (y * size + x) * 4;
        img.data[i] = r;
        img.data[i + 1] = g;
        img.data[i + 2] = b;
        img.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  });
  if (!canvas) return null;
  const texture = asRepeatingTexture(canvas);
  cache.set('carbon', texture);
  return texture;
};

/**
 * A tiling normal map of a lycra knit at roughly 1 mm.
 *
 * A dense grid of soft bumps: lycra reads as smooth cloth close up because the
 * knit is fine enough to disappear at any distance a rower is watched from,
 * and what stays is the way it catches the light along its ribs.
 */
export const lycraKnitNormalMap = (): THREE.CanvasTexture | null => {
  const cached = cache.get('lycra');
  if (cached) return cached;
  const canvas = buildCanvas(TEXTURE_SIZE, (ctx, size) => {
    const img = ctx.createImageData(size, size);
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const nx = Math.sin((x / 3) * Math.PI);
        const ny = Math.sin((y / 3) * Math.PI);
        const r = 128 + Math.round(nx * 18);
        const g = 128 + Math.round(ny * 18);
        const b = 255;
        const i = (y * size + x) * 4;
        img.data[i] = r;
        img.data[i + 1] = g;
        img.data[i + 2] = b;
        img.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  });
  if (!canvas) return null;
  const texture = asRepeatingTexture(canvas);
  cache.set('lycra', texture);
  return texture;
};
