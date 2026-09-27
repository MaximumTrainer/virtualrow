import { afterAll, afterEach, beforeAll, describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { facadeMaterial, FACADE_TILE_METRES } from '../components/rower3d/facadeMaterial';
import { resetDetailTexturesForTesting } from '../components/rower3d/detailTextures';
import { installCanvasMock } from './canvasMock';

let uninstallCanvas: () => void;
beforeAll(() => {
  uninstallCanvas = installCanvasMock();
});
afterAll(() => uninstallCanvas());

/**
 * Issue #432 — a facade picks its normal map from what colour the exporter
 * gave it. The wall's tint stays on the material as albedo; brick, plaster
 * and clapboard get their own tiling normals, and low tier drops the map.
 */

const source = (hex: string) =>
  new THREE.MeshStandardMaterial({ color: new THREE.Color(hex) });

afterEach(() => resetDetailTexturesForTesting());

describe('facadeMaterial (#432)', () => {
  it('carries the part colour as its albedo', () => {
    const src = source('#a24c2e');
    const mat = facadeMaterial(src, { tier: 'auto' });
    expect(mat.color.getHexString()).toBe('a24c2e');
  });

  it('picks the brick normal for a warm saturated colour', () => {
    const mat = facadeMaterial(source('#a24c2e'), { tier: 'auto' });
    expect(mat.normalMap).not.toBeNull();
    // The brick map is cached, so two calls on brick fixtures share the same
    // texture — a cheap way to name the kind without exposing its identity.
    const twice = facadeMaterial(source('#8a3a20'), { tier: 'auto' });
    expect(twice.normalMap).toBe(mat.normalMap);
  });

  it('picks the plaster normal for a bright neutral colour', () => {
    const mat = facadeMaterial(source('#f0e8d0'), { tier: 'auto' });
    const twice = facadeMaterial(source('#eee6d8'), { tier: 'auto' });
    expect(mat.normalMap).toBe(twice.normalMap);
  });

  it('picks the clapboard normal for a muted cool colour', () => {
    const mat = facadeMaterial(source('#6b7a70'), { tier: 'auto' });
    const twice = facadeMaterial(source('#4a6870'), { tier: 'auto' });
    expect(mat.normalMap).toBe(twice.normalMap);
  });

  it('gives the three kinds three different textures', () => {
    const b = facadeMaterial(source('#a24c2e'), { tier: 'auto' }).normalMap;
    const p = facadeMaterial(source('#f0e8d0'), { tier: 'auto' }).normalMap;
    const c = facadeMaterial(source('#6b7a70'), { tier: 'auto' }).normalMap;
    expect(b).not.toBe(p);
    expect(p).not.toBe(c);
    expect(b).not.toBe(c);
  });

  it('drops the normal map at low tier', () => {
    const mat = facadeMaterial(source('#a24c2e'), { tier: 'low' });
    expect(mat.normalMap).toBeNull();
  });

  it('holds a plain roughness so the wall reads as its material, not lacquer', () => {
    expect(facadeMaterial(source('#a24c2e'), { tier: 'auto' }).roughness).toBeGreaterThan(0.5);
    expect(facadeMaterial(source('#a24c2e'), { tier: 'auto' }).metalness).toBe(0);
  });

  it('names its tile size, so a caller can wire UVs', () => {
    // A constant, not the material's — the caller sizes the mesh's UVs from it.
    expect(FACADE_TILE_METRES).toBeGreaterThan(0);
  });
});
