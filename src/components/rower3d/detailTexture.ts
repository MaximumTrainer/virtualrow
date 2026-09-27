import * as THREE from 'three';

// ============================================================================
// GROUND DETAIL FOR THE BANKS AND THE FIELD BEYOND (#353)
//
// The banks were a 64 px greyscale mottle over a flat colour (#292): mottling,
// not detail — a rower saw the bank at a glancing angle from a moving boat,
// and the mottle broke the wash of green up enough to pass a horizontal-
// structure metric while still reading as a sheet close up.
//
// This is the pure half of replacing that with a real detail texture: a
// tileable grass or earth pattern generated in canvas, with a matching normal
// map derived from the same height noise. The bank material and its shader
// changes are the caller's step, not this one's — this ships the textures the
// caller reaches for.
//
// Cached by kind because a `MeshStandardMaterial` holds a reference to the
// texture it samples, and the banks build dozens of chunks. One shared texture
// per kind means one megabyte of canvas data, not thirty.
// ============================================================================

export type DetailKind = 'grass' | 'earth';

export interface DetailTextureSet {
  albedo: THREE.CanvasTexture;
  normal: THREE.DataTexture;
}

const cache = new Map<string, DetailTextureSet>();

/** Only for tests: forget the cached textures. */
export const resetDetailTextureCacheForTesting = (): void => {
  for (const set of cache.values()) {
    set.albedo.dispose();
    set.normal.dispose();
  }
  cache.clear();
};

/** Palette per kind. RGB in 0..255. */
const PALETTE: Record<DetailKind, [number, number, number]> = {
  grass: [84, 122, 52],
  earth: [102, 84, 62],
};

/**
 * Tileable value noise on a torus.
 *
 * The three summands each wrap in `x` and `y` on their own, so the resulting
 * field is periodic across the tile with no seam.
 */
const tileNoiseAt = (u: number, v: number): number =>
  0.5 +
  0.5 *
    (Math.sin(3 * u + Math.cos(5 * v)) * 0.5 +
      Math.sin(7 * v + Math.cos(11 * u)) * 0.3 +
      Math.sin(13 * u + 17 * v) * 0.2);

/**
 * Central-difference normal map from a scalar height field.
 *
 * `strength` scales the slope: a rider on this texture sees slope*strength as
 * the actual bump height. Encoded in tangent space, with wrap sampling at the
 * edges so the resulting texture tiles as well as its heights do.
 */
export const normalFromHeight = (
  heights: Float32Array,
  size: number,
  strength: number,
): THREE.DataTexture => {
  const data = new Uint8Array(size * size * 4);
  const at = (x: number, y: number): number => {
    // Wrap so the seam has real neighbours: without wrapping, the edge row
    // reads its own row twice and the normal there is skewed.
    const wx = (x + size) % size;
    const wy = (y + size) % size;
    return heights[wy * size + wx];
  };
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      // Tangent-space normal: X = -slope in x, Y = -slope in y, Z upward.
      const nx = -dx;
      const ny = -dy;
      const nz = 1;
      const inv = 1 / Math.sqrt(nx * nx + ny * ny + nz * nz);
      const i = (y * size + x) * 4;
      data[i] = Math.round((nx * inv * 0.5 + 0.5) * 255);
      data[i + 1] = Math.round((ny * inv * 0.5 + 0.5) * 255);
      data[i + 2] = Math.round((nz * inv * 0.5 + 0.5) * 255);
      data[i + 3] = 255;
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.needsUpdate = true;
  return texture;
};

/**
 * A tileable ground-detail texture and its matching normal map.
 *
 * The albedo modulates the palette by the height noise (`0.75 + 0.5 * n`), so
 * where the ground is high it reads bright and where it dips it reads dark —
 * which is what the eye reads as ground, not a swatch.
 */
export const createDetailTexture = (
  kind: DetailKind,
  size = 512,
): DetailTextureSet => {
  const key = `${kind}:${size}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    // A DetailTextureSet is what callers plumb into materials; an
    // undrawable canvas would tear that plumbing halfway. Ship a blank
    // texture whose parameters are still right, so the material lights it
    // as the palette colour and the scene keeps drawing.
    return blankSet(kind, size);
  }
  const img = ctx.createImageData(size, size);
  const heights = new Float32Array(size * size);
  const base = PALETTE[kind];
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const u = (x / size) * Math.PI * 2;
      const v = (y / size) * Math.PI * 2;
      const n = tileNoiseAt(u, v);
      heights[y * size + x] = n;
      const shade = 0.75 + 0.5 * n;
      const i = (y * size + x) * 4;
      img.data[i] = Math.min(255, Math.round(base[0] * shade));
      img.data[i + 1] = Math.min(255, Math.round(base[1] * shade));
      img.data[i + 2] = Math.min(255, Math.round(base[2] * shade));
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);

  const albedo = new THREE.CanvasTexture(canvas);
  albedo.wrapS = THREE.RepeatWrapping;
  albedo.wrapT = THREE.RepeatWrapping;
  albedo.colorSpace = THREE.SRGBColorSpace;
  albedo.needsUpdate = true;

  const normal = normalFromHeight(heights, size, 2.0);
  const set = { albedo, normal };
  cache.set(key, set);
  return set;
};

/**
 * The escape hatch: a solid-palette 1×1 texture pair with the right params.
 *
 * A caller that dropped this into a material and asked "is this the palette
 * colour?" gets yes, which is what the current bank looks like — so the visual
 * regression is zero, and the missing canvas is the only bug.
 */
const blankSet = (kind: DetailKind, size: number): DetailTextureSet => {
  const base = PALETTE[kind];
  const data = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i += 1) {
    data[i * 4] = base[0];
    data[i * 4 + 1] = base[1];
    data[i * 4 + 2] = base[2];
    data[i * 4 + 3] = 255;
  }
  const albedoData = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  albedoData.wrapS = THREE.RepeatWrapping;
  albedoData.wrapT = THREE.RepeatWrapping;
  albedoData.colorSpace = THREE.SRGBColorSpace;
  albedoData.needsUpdate = true;
  const heights = new Float32Array(size * size).fill(0.5);
  const normal = normalFromHeight(heights, size, 0);
  // A DataTexture satisfies the same interface a CanvasTexture does for the
  // caller here; the cast keeps the return type honest for the happy path.
  return { albedo: albedoData as unknown as THREE.CanvasTexture, normal };
};
