import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import * as THREE from 'three';
import { installCanvasMock } from './canvasMock';
import {
  createDetailTexture,
  normalFromHeight,
  resetDetailTextureCacheForTesting,
} from '../components/rower3d/detailTexture';

let teardown: (() => void) | null = null;
beforeAll(() => { teardown = installCanvasMock(); });
afterAll(() => { teardown?.(); });
beforeEach(() => resetDetailTextureCacheForTesting());

describe('createDetailTexture (#353)', () => {
  it('grass returns an albedo and normal with sRGB and repeat wrapping', () => {
    const { albedo, normal } = createDetailTexture('grass', 32);
    expect(albedo).toBeInstanceOf(THREE.CanvasTexture);
    expect(albedo.wrapS).toBe(THREE.RepeatWrapping);
    expect(albedo.wrapT).toBe(THREE.RepeatWrapping);
    expect(albedo.colorSpace).toBe(THREE.SRGBColorSpace);
    expect(normal.wrapS).toBe(THREE.RepeatWrapping);
    expect(normal.wrapT).toBe(THREE.RepeatWrapping);
  });

  it('earth returns a different albedo than grass', () => {
    // The two kinds share the generator; the palette is what changes.
    const grass = createDetailTexture('grass', 16);
    const earth = createDetailTexture('earth', 16);
    expect(grass.albedo).not.toBe(earth.albedo);
  });

  it('the same kind is cached and returns the same textures twice', () => {
    // Each detail texture is roughly a megabyte; a fresh instance per bank
    // chunk would allocate one per chunk, and there are hundreds.
    const first = createDetailTexture('grass', 16);
    const second = createDetailTexture('grass', 16);
    expect(first.albedo).toBe(second.albedo);
    expect(first.normal).toBe(second.normal);
  });
});

describe('normalFromHeight (#353)', () => {
  it('a flat height field encodes as neutral blue at every pixel', () => {
    // Central differences on a constant give zero, and (0,0,1) tangent-space
    // normals encode to (128, 128, 255) — "surface faces straight up".
    const size = 4;
    const heights = new Float32Array(size * size).fill(0.5);
    const texture = normalFromHeight(heights, size, 2.0);
    expect(texture).toBeInstanceOf(THREE.DataTexture);
    // The DataTexture buffer is RGBA in row-major order.
    const data = (texture.image as { data: Uint8Array }).data;
    for (let i = 0; i < size * size; i += 1) {
      expect(data[i * 4]).toBe(128);
      expect(data[i * 4 + 1]).toBe(128);
      expect(data[i * 4 + 2]).toBe(255);
      expect(data[i * 4 + 3]).toBe(255);
    }
  });

  it('a height field with a bump encodes a tilted normal', () => {
    // A single-cell bump has a slope on the ring around it, so at least one
    // pixel encodes a red or green channel away from 128.
    const size = 8;
    const heights = new Float32Array(size * size).fill(0.5);
    heights[3 * size + 3] = 1;
    const texture = normalFromHeight(heights, size, 2.0);
    const data = (texture.image as { data: Uint8Array }).data;
    let anyTilt = false;
    for (let i = 0; i < size * size; i += 1) {
      const r = data[i * 4];
      const g = data[i * 4 + 1];
      if (r !== 128 || g !== 128) {
        anyTilt = true;
        break;
      }
    }
    expect(anyTilt).toBe(true);
  });
});
