import { afterAll, beforeAll, describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { installCanvasMock } from './canvasMock';
import {
  applyScenerySkyPass,
  isBuildingPath,
  isWindowColor,
  tierFromPath,
} from '../components/rower3d/scenerySkyPass';

let uninstallCanvas: () => void;
beforeAll(() => {
  uninstallCanvas = installCanvasMock();
});
afterAll(() => uninstallCanvas());

const buildingWithParts = (parts: { name: string; hex: string }[]) => {
  const group = new THREE.Group();
  for (const part of parts) {
    const mat = new THREE.MeshStandardMaterial({ color: new THREE.Color(part.hex) });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), mat);
    mesh.name = part.name;
    group.add(mesh);
  }
  return group;
};

describe('tierFromPath / isBuildingPath (#432)', () => {
  it('reads the tier off a scenery GLB path', () => {
    expect(tierFromPath('/scenery/tier-b/b03-boathouse.glb')).toBe('tier-b');
    expect(tierFromPath('/scenery/tier-d/d10-brick-terrace.glb')).toBe('tier-d');
    expect(tierFromPath('/scenery/tier-e/e01-oak.glb')).toBe('tier-e');
  });

  it('names tier-b, tier-d and tier-g as building tiers, and only them', () => {
    expect(isBuildingPath('/x/tier-b/foo.glb')).toBe(true);
    expect(isBuildingPath('/x/tier-d/foo.glb')).toBe(true);
    expect(isBuildingPath('/x/tier-g/foo.glb')).toBe(true);
    expect(isBuildingPath('/x/tier-e/foo.glb')).toBe(false);
    expect(isBuildingPath('/x/tier-f/foo.glb')).toBe(false);
  });
});

describe('isWindowColor (#432)', () => {
  it('recognises the exporter’s glaze palette', () => {
    expect(isWindowColor(new THREE.Color('#2a3a44'))).toBe(true);
    expect(isWindowColor(new THREE.Color('#3a4e5a'))).toBe(true);
  });

  it('does not confuse a facade colour for glass', () => {
    expect(isWindowColor(new THREE.Color('#a24c2e'))).toBe(false);
    expect(isWindowColor(new THREE.Color('#f0e8d0'))).toBe(false);
    expect(isWindowColor(new THREE.Color('#6b7a70'))).toBe(false);
  });
});

describe('applyScenerySkyPass (#432)', () => {
  it('swaps a building’s facade parts for a facade material', () => {
    const scene = buildingWithParts([
      { name: 'wall', hex: '#a24c2e' },
      { name: 'wall2', hex: '#f0e8d0' },
    ]);

    applyScenerySkyPass(scene, 'medium');

    const meshes = scene.children as THREE.Mesh[];
    expect(meshes[0].material).toBeInstanceOf(THREE.MeshStandardMaterial);
    // A facade at auto carries a normal map.
    expect((meshes[0].material as THREE.MeshStandardMaterial).normalMap).not.toBeNull();
  });

  it('swaps a glass part for a physical window material', () => {
    const scene = buildingWithParts([
      { name: 'window', hex: '#2a3a44' },
    ]);

    applyScenerySkyPass(scene, 'medium');

    const mesh = scene.children[0] as THREE.Mesh;
    expect(mesh.material).toBeInstanceOf(THREE.MeshPhysicalMaterial);
  });

  it('is idempotent — a second pass leaves the swapped materials in place', () => {
    const scene = buildingWithParts([{ name: 'wall', hex: '#a24c2e' }]);

    applyScenerySkyPass(scene, 'medium');
    const first = (scene.children[0] as THREE.Mesh).material;
    applyScenerySkyPass(scene, 'medium');
    const second = (scene.children[0] as THREE.Mesh).material;

    expect(second).toBe(first);
  });

  it('lifts every replacement with the scenery env-map intensity', () => {
    const scene = buildingWithParts([{ name: 'wall', hex: '#a24c2e' }]);

    applyScenerySkyPass(scene, 'medium');

    const mat = (scene.children[0] as THREE.Mesh).material as THREE.MeshStandardMaterial;
    expect(mat.envMapIntensity).toBeGreaterThan(0);
  });

  it('drops the normal map on low tier facades', () => {
    const scene = buildingWithParts([{ name: 'wall', hex: '#a24c2e' }]);

    applyScenerySkyPass(scene, 'basic');

    const mat = (scene.children[0] as THREE.Mesh).material as THREE.MeshStandardMaterial;
    expect(mat.normalMap).toBeNull();
  });
});
