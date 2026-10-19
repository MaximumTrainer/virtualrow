import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as THREE from 'three';
import ReactThreeTestRenderer from '@react-three/test-renderer';
import { installCanvasMock } from './canvasMock';

/**
 * #496 Phase 2 (AC4) — `vegetationComponents.tsx` has no `grassMeshRef`
 * after the change. The bank's grass is now a density-field contribution in
 * `bankMaterial.ts`, so the single-tuft `InstancedMesh` branch (GRASS_MAX = 80
 * crossed planes) is gone. Reeds and rocks remain as `InstancedMesh` because
 * they are 3-D props the shader-painted cover cannot replace (D4-a).
 */

const { GroundCover } = await import('../components/rower3d/vegetationComponents');

const isInstanced = (o: THREE.Object3D): o is THREE.InstancedMesh =>
  (o as THREE.InstancedMesh).isInstancedMesh === true;

/** The geometry type an instancedMesh wraps — reeds use CylinderGeometry,
 *  rocks SphereGeometry, and the retired grass used PlaneGeometry. */
const geometryKind = (mesh: THREE.InstancedMesh): string => mesh.geometry.type;

describe('GroundCover (#496 Phase 2)', () => {
  let uninstall: () => void;
  beforeAll(() => {
    uninstall = installCanvasMock();
  });
  afterAll(() => uninstall());

  const mount = async () => {
    const renderer = await ReactThreeTestRenderer.create(<GroundCover />);
    const scene = renderer.scene.instance as unknown as THREE.Scene;
    const found: THREE.Object3D[] = [];
    scene.traverse((o) => found.push(o));
    return { renderer, instanced: found.filter(isInstanced) };
  };

  it('renders no PlaneGeometry InstancedMesh — the GRASS_MAX branch is gone', async () => {
    const { renderer, instanced } = await mount();
    const planes = instanced.filter((m) => geometryKind(m) === 'PlaneGeometry');
    expect(planes).toHaveLength(0);
    await renderer.unmount();
  });

  it('still renders reeds (CylinderGeometry) — D4-a keeps the 3-D props', async () => {
    const { renderer, instanced } = await mount();
    const kinds = new Set(instanced.map(geometryKind));
    expect(kinds.has('CylinderGeometry')).toBe(true);
    await renderer.unmount();
  });
});
