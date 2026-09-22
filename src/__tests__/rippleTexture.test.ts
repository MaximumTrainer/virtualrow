import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as THREE from 'three';
import { installCanvasMock } from './canvasMock';
import {
  RIPPLE_TEXTURE_SIZE,
  RIPPLE_WAVELENGTH_RANGE_METRES,
  createRippleNormalMap,
  rippleWavelengthsMetres,
} from '../components/rower3d/rippleTexture';
import { RIPPLE_TILE_METRES } from '../components/rower3d/waterMaterial';

/**
 * Issue #324 — the chop the mesh cannot carry.
 *
 * The channel is a two-vertex-wide ribbon sampled every 15 m, so the 1.5–6 m
 * waves VR-04 asks for cannot exist in its vertices. They exist here instead,
 * per-pixel, where there is no sampling limit.
 */

describe('the chop the ripple texture carries', () => {
  it('is the range the issue asked for', () => {
    const [shortest, longest] = [
      Math.min(...rippleWavelengthsMetres()),
      Math.max(...rippleWavelengthsMetres()),
    ];

    expect(shortest).toBeGreaterThanOrEqual(RIPPLE_WAVELENGTH_RANGE_METRES[0]);
    expect(longest).toBeLessThanOrEqual(RIPPLE_WAVELENGTH_RANGE_METRES[1]);
  });

  // A tiling texture whose waves do not close at the tile edge shows its seams
  // — a grid of them, right across the river.
  it('fits a whole number of cycles into the tile, so it has no seams', () => {
    for (const wavelength of rippleWavelengthsMetres()) {
      const cycles = RIPPLE_TILE_METRES / wavelength;
      expect(cycles, `${wavelength} m does not close on the tile`).toBeCloseTo(
        Math.round(cycles),
        6,
      );
    }
  });

  it('carries more than one wavelength, or it is corduroy rather than water', () => {
    expect(new Set(rippleWavelengthsMetres()).size).toBeGreaterThan(1);
  });
});

describe('createRippleNormalMap', () => {
  it('returns nothing rather than throwing where there is no context to draw in', () => {
    expect(() => createRippleNormalMap()).not.toThrow();
    expect(createRippleNormalMap()).toBeNull();
  });

  describe('with a canvas to draw into', () => {
    let uninstall: () => void;
    beforeAll(() => {
      uninstall = installCanvasMock();
    });
    afterAll(() => uninstall());

    it('is a square tile that repeats both ways', () => {
      const texture = createRippleNormalMap();

      expect(texture, 'no ripple texture was produced').not.toBeNull();
      expect(texture!.image.width).toBe(RIPPLE_TEXTURE_SIZE);
      expect(texture!.image.height).toBe(RIPPLE_TEXTURE_SIZE);
      expect(texture!.wrapS).toBe(THREE.RepeatWrapping);
      expect(texture!.wrapT).toBe(THREE.RepeatWrapping);
    });

    // A normal map holds directions, not colour. Tagged sRGB it would be
    // gamma-decoded on the way in and every slope would come out wrong — the
    // water would be lit as though its waves leaned the wrong way.
    it('is not treated as colour', () => {
      expect(createRippleNormalMap()!.colorSpace).toBe(THREE.NoColorSpace);
    });
  });
});
