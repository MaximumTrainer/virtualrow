/**
 * Three-free port of `src/components/rower3d/foliageTexture.ts`'s
 * `paintFoliage`. The React file imports three for its `CanvasTexture`
 * wrapper; the pixel-painting half is pure math and is copied here so the
 * WebGPU engine can create a `GPUTexture` from the same output.
 *
 * Returns, for each `FoliageShape`, a `size × size` RGBA buffer whose alpha
 * channel is the leaf silhouette and whose RGB is a leaf-grey tone shaded
 * lighter toward the top of each clump. The engine's foliage pass samples
 * these as a 3-layer `texture_2d_array<f32>` keyed on the metadata species
 * index, discards transparent pixels, and multiplies the leaf-grey by the
 * species palette so each tree reads as its own shape and colour.
 */

import { seededRandom } from './seededRandom';

export type FoliageShape = 'broadleaf' | 'conifer' | 'willow';
export const FOLIAGE_SHAPES: readonly FoliageShape[] = ['broadleaf', 'conifer', 'willow'];

interface Blob {
  x: number; y: number; rx: number; ry: number; tone: number;
}

interface Trunk { top: number; halfWidth: number }
interface ShapePlan { blobs: Blob[]; trunk: Trunk }

const drawFor = (shape: FoliageShape) => {
  const base = { broadleaf: 1, conifer: 5003, willow: 9011 }[shape];
  return (i: number, k: number) => seededRandom(base + i * 7 + k);
};

const toneAt = (y: number, jitter: number): number => (0.8 + 0.2 * jitter) * (1.12 - 0.25 * y);

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

const coniferPlan = (): ShapePlan => {
  const draw = drawFor('conifer');
  const tip = 0.04;
  const depth = 0.78;
  const blobs = Array.from({ length: 150 }, (_, i): Blob => {
    const down = Math.pow(draw(i, 1), 0.65);
    const y = tip + depth * down;
    const halfWidth = 0.4 * down;
    const radius = (0.035 + 0.035 * draw(i, 3)) * (0.5 + 0.5 * down);
    return { x: 0.5 + (draw(i, 2) - 0.5) * 2 * halfWidth, y, rx: radius * 1.4, ry: radius * 0.75, tone: toneAt(y, draw(i, 4)) };
  });
  return { blobs, trunk: { top: 0.7, halfWidth: 0.025 } };
};

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

const TRUNK_LUMA = 70;
const PAINT_OVER = 0.25;

/**
 * The RGBA pixels of a `shape`'s billboard, `size` square, top row first.
 * Alpha is the silhouette; RGB is a leaf-grey tone shaded lighter to the
 * top of each clump. Mirrors `src/components/rower3d/foliageTexture.ts`.
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
