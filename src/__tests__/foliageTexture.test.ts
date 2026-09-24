import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as THREE from 'three';
import { installCanvasMock } from './canvasMock';
import {
  FOLIAGE_SHAPES,
  createFoliageTexture,
  foliageShapeFor,
  paintFoliage,
  type FoliageShape,
} from '../components/rower3d/foliageTexture';

/**
 * Issue #333 — the leaf mass on a foliage billboard.
 *
 * The trees were stacked cones, and the kit's were spheres on sticks. A crossed
 * billboard is only as good as the silhouette painted on it, so what is
 * checked is the silhouette: how much of the square it fills, where, and that
 * it is the same every visit.
 */

const SIZE = 128;

/** Share of a set of rows whose alpha would survive the material's alphaTest. */
const coverage = (pixels: Uint8ClampedArray, size: number, fromRow = 0, toRow = size): number => {
  let solid = 0;
  for (let y = fromRow; y < toRow; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (pixels[(y * size + x) * 4 + 3] >= 128) solid += 1;
    }
  }
  return solid / ((toRow - fromRow) * size);
};

/** Mean absolute luma step between horizontal neighbours inside the canopy. */
const leafDetail = (pixels: Uint8ClampedArray, size: number): number => {
  let total = 0;
  let pairs = 0;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x + 1 < size; x += 1) {
      const i = (y * size + x) * 4;
      if (pixels[i + 3] < 128 || pixels[i + 7] < 128) continue;
      total += Math.abs(pixels[i + 1] - pixels[i + 5]);
      pairs += 1;
    }
  }
  return pairs ? total / pairs : 0;
};

describe('paintFoliage', () => {
  it.each(FOLIAGE_SHAPES)('paints a %s that fills between a fifth and three fifths of its square', (shape) => {
    const pixels = paintFoliage(shape, SIZE);

    expect(pixels.length).toBe(SIZE * SIZE * 4);
    const covered = coverage(pixels, SIZE);
    expect(covered).toBeGreaterThan(0.2);
    expect(covered).toBeLessThan(0.6);
  });

  it('narrows a conifer toward its top', () => {
    const pixels = paintFoliage('conifer', SIZE);
    const quarter = SIZE / 4;

    const top = coverage(pixels, SIZE, 0, quarter);
    const lowerCrown = coverage(pixels, SIZE, quarter * 2, quarter * 3);

    expect(top).toBeLessThan(lowerCrown * 0.6);
  });

  it('keeps a trunk under every crown, where it meets the ground', () => {
    for (const shape of FOLIAGE_SHAPES) {
      const pixels = paintFoliage(shape, SIZE);
      const bottomCentre = ((SIZE - 1) * SIZE + SIZE / 2) * 4;
      expect(pixels[bottomCentre + 3], `${shape} floats off the ground`).toBe(255);
      // And nothing at the bottom corners: a tree, not a hedge.
      expect(pixels[(SIZE - 1) * SIZE * 4 + 3]).toBe(0);
    }
  });

  it('shades the leaf mass rather than filling it flat', () => {
    // Flat white under a species colour is a cut-out. The dappling is what the
    // eye reads as leaves, and what the hero's horizontal-structure gate sees.
    for (const shape of FOLIAGE_SHAPES) {
      expect(leafDetail(paintFoliage(shape, SIZE), SIZE), shape).toBeGreaterThan(4);
    }
  });

  it('draws each shape its own way', () => {
    const broadleaf = paintFoliage('broadleaf', SIZE);
    const willow = paintFoliage('willow', SIZE);
    expect(Array.from(broadleaf)).not.toEqual(Array.from(willow));
  });

  it('is deterministic, so a tree looks the same on every visit', () => {
    for (const shape of FOLIAGE_SHAPES) {
      expect(Array.from(paintFoliage(shape, 64))).toEqual(Array.from(paintFoliage(shape, 64)));
    }
  });
});

describe('createFoliageTexture', () => {
  let uninstall: () => void;
  beforeAll(() => {
    uninstall = installCanvasMock();
  });
  afterAll(() => uninstall());

  it.each(FOLIAGE_SHAPES)('builds a size-by-size sRGB texture for a %s', (shape: FoliageShape) => {
    const texture = createFoliageTexture(shape, SIZE);

    expect(texture).toBeInstanceOf(THREE.CanvasTexture);
    const canvas = texture.image as HTMLCanvasElement;
    expect(canvas.width).toBe(SIZE);
    expect(canvas.height).toBe(SIZE);
    expect(texture.colorSpace).toBe(THREE.SRGBColorSpace);
    texture.dispose();
  });

  it('defaults to 256 pixels square', () => {
    const texture = createFoliageTexture('broadleaf');
    expect((texture.image as HTMLCanvasElement).width).toBe(256);
    texture.dispose();
  });
});

describe('foliageShapeFor', () => {
  it('draws pines and cypresses as conifers', () => {
    expect(foliageShapeFor('pine')).toBe('conifer');
    expect(foliageShapeFor('cypress')).toBe('conifer');
  });

  it('draws a willow as a willow', () => {
    expect(foliageShapeFor('willow')).toBe('willow');
  });

  it('draws every other species as a broadleaf', () => {
    for (const type of ['oak', 'ornamental', 'palm', 'bare'] as const) {
      expect(foliageShapeFor(type)).toBe('broadleaf');
    }
  });
});
