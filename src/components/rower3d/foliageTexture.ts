// ============================================================================
// FOLIAGE TEXTURE — the leaf mass painted on a crossed billboard (#333).
//
// The bank trees were four stacked cones on a cylinder, eleven meshes a tree,
// and the kit's were CAD spheres on sticks. Both read as toys at any distance,
// and eleven draw calls a tree is why the banks could never be dense enough to
// look planted: the route had one tree per ~340 m of bank.
//
// A tree is now two crossed quads with this texture on them, instanced per
// species. The silhouette is everything a billboard has, so it is painted
// here, pixel by pixel and seeded - no downloads, no canvas drawing API, and
// the same tree on every visit. The pixels are white shaded to grey: the
// species colour comes from the material, so one texture per shape serves
// every species of that shape.
// ============================================================================
import * as THREE from 'three';
import { seededRandom } from './helpers';

export type FoliageShape = 'broadleaf' | 'conifer' | 'willow';

export const FOLIAGE_SHAPES: readonly FoliageShape[] = ['broadleaf', 'conifer', 'willow'];

/**
 * The silhouette a species is drawn with.
 *
 * A string rather than the config's union because the scenery profiles name
 * their species as plain strings, and an unknown one is simply a broadleaf.
 */
export const foliageShapeFor = (type: string): FoliageShape => {
  if (type === 'pine' || type === 'cypress') return 'conifer';
  if (type === 'willow') return 'willow';
  return 'broadleaf';
};

/** A clump of leaves: centre and radii as fractions of the square, and its tone. */
interface Blob {
  x: number;
  y: number;
  rx: number;
  ry: number;
  tone: number;
}

/** Where the trunk is drawn, as fractions of the square; y runs down from the top. */
interface Trunk {
  top: number;
  halfWidth: number;
}

interface ShapePlan {
  blobs: Blob[];
  trunk: Trunk;
}

/** A seeded draw, distinct per shape so the three do not share a scatter. */
const drawFor = (shape: FoliageShape) => {
  const base = { broadleaf: 1, conifer: 5003, willow: 9011 }[shape];
  return (i: number, k: number) => seededRandom(base + i * 7 + k);
};

/**
 * Leaves are lighter where the sun reaches them, at the top of the crown.
 *
 * `y` is the clump's height in the square, top down; the jitter keeps
 * neighbouring clumps from sharing a tone, which is what makes a mass of them
 * read as foliage rather than as one blob.
 *
 * Kept near white. The texture is sRGB and the species colour multiplies it,
 * so a mid-grey tone here is about 0.3 once linear: under the config's dark
 * greens that drew the trees nearest the camera black.
 */
const toneAt = (y: number, jitter: number): number => (0.8 + 0.2 * jitter) * (1.12 - 0.25 * y);

/** A round crown: clumps packed into an ellipse, denser toward its middle. */
const broadleafPlan = (): ShapePlan => {
  const draw = drawFor('broadleaf');
  const blobs = Array.from({ length: 70 }, (_, i): Blob => {
    const angle = draw(i, 1) * Math.PI * 2;
    const reach = Math.sqrt(draw(i, 2)) * 0.82;
    const y = 0.4 + Math.sin(angle) * 0.32 * reach;
    const radius = 0.06 + 0.06 * draw(i, 3);
    return { x: 0.5 + Math.cos(angle) * 0.38 * reach, y, rx: radius, ry: radius, tone: toneAt(y, draw(i, 4)) };
  });
  return { blobs, trunk: { top: 0.55, halfWidth: 0.03 } };
};

/**
 * A spire: clumps packed into a triangle, more of them at its broad base and
 * smaller toward the tip, so the silhouette narrows rather than ending in a
 * ball.
 */
const coniferPlan = (): ShapePlan => {
  const draw = drawFor('conifer');
  const tip = 0.04;
  const depth = 0.78;
  const blobs = Array.from({ length: 150 }, (_, i): Blob => {
    const down = Math.pow(draw(i, 1), 0.65);
    const y = tip + depth * down;
    const halfWidth = 0.4 * down;
    // Wider than tall: a conifer's clumps are the ends of level boughs.
    const radius = (0.035 + 0.035 * draw(i, 3)) * (0.5 + 0.5 * down);
    return {
      x: 0.5 + (draw(i, 2) - 0.5) * 2 * halfWidth,
      y,
      rx: radius * 1.4,
      ry: radius * 0.75,
      tone: toneAt(y, draw(i, 4)),
    };
  });
  return { blobs, trunk: { top: 0.7, halfWidth: 0.025 } };
};

/**
 * A dome with curtains hanging from it: round clumps across the top, then
 * narrow ones drawn long and low around the edge, the way a willow weeps.
 */
const willowPlan = (): ShapePlan => {
  const draw = drawFor('willow');
  const dome = Array.from({ length: 48 }, (_, i): Blob => {
    const angle = draw(i, 1) * Math.PI * 2;
    const reach = Math.sqrt(draw(i, 2)) * 0.85;
    const y = 0.3 + Math.sin(angle) * 0.22 * reach;
    const radius = 0.055 + 0.05 * draw(i, 3);
    return { x: 0.5 + Math.cos(angle) * 0.4 * reach, y, rx: radius, ry: radius, tone: toneAt(y, draw(i, 4)) };
  });
  const curtains = Array.from({ length: 56 }, (_, n): Blob => {
    const i = n + 100;
    // Hung from the rim of the dome, the middle of a willow being trunk and shade.
    const across = draw(i, 1) - 0.5;
    const x = 0.5 + Math.sign(across) * (0.12 + 0.3 * Math.sqrt(Math.abs(across) * 2));
    const y = 0.42 + 0.26 * draw(i, 2);
    const radius = 0.022 + 0.018 * draw(i, 3);
    return { x, y, rx: radius, ry: radius * 4.5, tone: toneAt(y, draw(i, 4)) * 0.9 };
  });
  return { blobs: [...dome, ...curtains], trunk: { top: 0.45, halfWidth: 0.035 } };
};

const PLANS: Record<FoliageShape, () => ShapePlan> = {
  broadleaf: broadleafPlan,
  conifer: coniferPlan,
  willow: willowPlan,
};

/** Trunk grey, before the species colour multiplies it. */
const TRUNK_LUMA = 70;

/**
 * Past this much of a clump's falloff it is drawn over whatever is under it.
 *
 * Below the alpha test's cut, so a clump's colour reaches out to where its
 * edge is cut and the join between two clumps is a change of tone, not a seam
 * of the one underneath.
 */
const PAINT_OVER = 0.25;

/**
 * The RGBA pixels of a `shape`'s billboard, `size` square, top row first.
 *
 * Alpha is the silhouette - solid where a clump is, fading at its rim so the
 * mipmaps soften a distant tree rather than eroding it. Colour is a grey leaf
 * tone, shaded lighter to the top of each clump and of the crown, with a
 * per-pixel grain for the leaves themselves.
 */
export const paintFoliage = (shape: FoliageShape, size: number): Uint8ClampedArray => {
  const pixels = new Uint8ClampedArray(size * size * 4);
  const { blobs, trunk } = PLANS[shape]();

  const x0 = Math.floor(size * (0.5 - trunk.halfWidth));
  const x1 = Math.ceil(size * (0.5 + trunk.halfWidth));
  for (let y = Math.floor(size * trunk.top); y < size; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      pixels.set([TRUNK_LUMA, TRUNK_LUMA, TRUNK_LUMA, 255], (y * size + x) * 4);
    }
  }

  const grainSeed = { broadleaf: 17, conifer: 29, willow: 41 }[shape];
  for (const blob of blobs) {
    const cx = blob.x * size;
    const cy = blob.y * size;
    const rx = blob.rx * size;
    const ry = blob.ry * size;
    const left = Math.max(0, Math.floor(cx - rx));
    const right = Math.min(size - 1, Math.ceil(cx + rx));
    const top = Math.max(0, Math.floor(cy - ry));
    const bottom = Math.min(size - 1, Math.ceil(cy + ry));
    for (let y = top; y <= bottom; y += 1) {
      for (let x = left; x <= right; x += 1) {
        const dx = (x + 0.5 - cx) / rx;
        const dy = (y + 0.5 - cy) / ry;
        const grain = seededRandom(grainSeed + x * 131 + y * 977);
        // The grain eats into the rim too, so a clump's edge is ragged leaves
        // rather than a drawn circle.
        const falloff = 1 - (dx * dx + dy * dy) - 0.35 * (grain - 0.5);
        if (falloff <= 0) continue;
        const i = (y * size + x) * 4;
        pixels[i + 3] = Math.max(pixels[i + 3], Math.round(255 * Math.min(1, falloff * 1.6)));
        if (falloff < PAINT_OVER) continue;
        const lit = 1 - 0.22 * dy;
        const luma = Math.round(255 * blob.tone * (0.88 + 0.12 * falloff) * lit * (0.8 + 0.3 * grain));
        pixels[i] = luma;
        pixels[i + 1] = luma;
        pixels[i + 2] = luma;
      }
    }
  }
  return pixels;
};

/**
 * The billboard texture for a `shape`, from `paintFoliage`.
 *
 * sRGB because the tones were chosen by eye, as a colour is, and a canvas
 * texture because that is how three takes pixels it did not load.
 */
export const createFoliageTexture = (shape: FoliageShape, size = 256): THREE.CanvasTexture => {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const image = ctx.createImageData(size, size);
  image.data.set(paintFoliage(shape, size));
  ctx.putImageData(image, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
};
