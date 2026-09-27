import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import * as THREE from 'three';
import { installCanvasMock } from './canvasMock';
import {
  applyMaterialPass,
  resetMaterialPassCacheForTesting,
} from '../components/rower3d/materialPass';

let teardownCanvas: (() => void) | null = null;
beforeAll(() => { teardownCanvas = installCanvasMock(); });
afterAll(() => { teardownCanvas?.(); });

const meshWith = (name: string, colorHex = '#ff0000'): THREE.Mesh => {
  const geometry = new THREE.PlaneGeometry(1, 1);
  const material = new THREE.MeshStandardMaterial({ color: new THREE.Color(colorHex) });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  return mesh;
};

const scullFixture = (): THREE.Group => {
  const g = new THREE.Group();
  g.add(meshWith('Hull_part', '#e0e0e0'));
  g.add(meshWith('Rower_Torso', '#0055aa'));
  g.add(meshWith('Rower_Head', '#f0c8ad'));
  g.add(meshWith('LeftOar_Blade_part', '#ffdd44'));
  g.add(meshWith('UnknownPart', '#333333'));
  return g;
};

describe('applyMaterialPass (#354)', () => {
  beforeEach(() => resetMaterialPassCacheForTesting());
  afterEach(() => resetMaterialPassCacheForTesting());

  it('the hull becomes a physical material with a clearcoat and a normal map at auto', () => {
    const root = scullFixture();
    applyMaterialPass(root, { tier: 'auto' });
    const hull = root.getObjectByName('Hull_part') as THREE.Mesh;
    const mat = hull.material as THREE.MeshPhysicalMaterial;
    expect(mat).toBeInstanceOf(THREE.MeshPhysicalMaterial);
    expect(mat.clearcoat).toBe(1);
    expect(mat.clearcoatRoughness).toBeCloseTo(0.08, 5);
    expect(mat.roughness).toBeCloseTo(0.25, 5);
    expect(mat.envMapIntensity).toBeCloseTo(1.2, 5);
    expect(mat.normalMap).not.toBeNull();
  });

  it('cloth on the rower gets sheen and a lycra normal map at auto', () => {
    const root = scullFixture();
    applyMaterialPass(root, { tier: 'auto' });
    const torso = root.getObjectByName('Rower_Torso') as THREE.Mesh;
    const mat = torso.material as THREE.MeshPhysicalMaterial;
    expect(mat).toBeInstanceOf(THREE.MeshPhysicalMaterial);
    expect(mat.roughness).toBeCloseTo(0.7, 5);
    expect(mat.sheen).toBeGreaterThan(0);
    expect(mat.normalMap).not.toBeNull();
  });

  it('skin gets its own sheen colour without a normal map', () => {
    const root = scullFixture();
    applyMaterialPass(root, { tier: 'auto' });
    const head = root.getObjectByName('Rower_Head') as THREE.Mesh;
    const mat = head.material as THREE.MeshPhysicalMaterial;
    expect(mat).toBeInstanceOf(THREE.MeshPhysicalMaterial);
    expect(mat.roughness).toBeCloseTo(0.55, 5);
    expect(mat.sheen).toBeGreaterThan(0);
    expect(mat.normalMap).toBeNull();
  });

  it('the blade becomes a physical material with a light clearcoat', () => {
    const root = scullFixture();
    applyMaterialPass(root, { tier: 'auto' });
    const blade = root.getObjectByName('LeftOar_Blade_part') as THREE.Mesh;
    const mat = blade.material as THREE.MeshPhysicalMaterial;
    expect(mat).toBeInstanceOf(THREE.MeshPhysicalMaterial);
    expect(mat.roughness).toBeCloseTo(0.4, 5);
    expect(mat.clearcoat).toBeCloseTo(0.5, 5);
  });

  it('the low tier drops every normal map', () => {
    const root = scullFixture();
    applyMaterialPass(root, { tier: 'low' });
    const hull = root.getObjectByName('Hull_part') as THREE.Mesh;
    const torso = root.getObjectByName('Rower_Torso') as THREE.Mesh;
    expect((hull.material as THREE.MeshPhysicalMaterial).normalMap).toBeNull();
    expect((torso.material as THREE.MeshPhysicalMaterial).normalMap).toBeNull();
  });

  it('the source material is disposed once its replacement is installed', () => {
    const root = scullFixture();
    const hull = root.getObjectByName('Hull_part') as THREE.Mesh;
    const sourceMat = hull.material as THREE.MeshStandardMaterial;
    const dispose = vi.spyOn(sourceMat, 'dispose');
    applyMaterialPass(root, { tier: 'auto' });
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it('an unrecognised node is left with its original material', () => {
    const root = scullFixture();
    const other = root.getObjectByName('UnknownPart') as THREE.Mesh;
    const originalMat = other.material as THREE.MeshStandardMaterial;
    applyMaterialPass(root, { tier: 'auto' });
    expect(other.material).toBe(originalMat);
  });

  it('a second pass on the same node is a no-op', () => {
    const root = scullFixture();
    applyMaterialPass(root, { tier: 'auto' });
    const hull = root.getObjectByName('Hull_part') as THREE.Mesh;
    const firstReplacement = hull.material;
    applyMaterialPass(root, { tier: 'auto' });
    expect(hull.material).toBe(firstReplacement);
  });

  it('the base colour of each part is preserved', () => {
    const root = scullFixture();
    applyMaterialPass(root, { tier: 'auto' });
    const hull = root.getObjectByName('Hull_part') as THREE.Mesh;
    const hex = (hull.material as THREE.MeshPhysicalMaterial).color.getHexString();
    expect(hex).toBe('e0e0e0');
  });
});
