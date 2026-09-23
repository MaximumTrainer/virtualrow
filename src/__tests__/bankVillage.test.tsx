import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import * as THREE from 'three';
import ReactThreeTestRenderer from '@react-three/test-renderer';
import { installCanvasMock } from './canvasMock';
import { SCENE_CONFIG } from '../components/rower3d/themeConfig';

/**
 * Issue #364 — the village houses are dressed from the scene config.
 *
 * The theme that used to be threaded to the bank is gone, and the art
 * direction is read directly. That must not have turned into colours inlined
 * where the house is built: the wall and the roof are still the config's.
 */
vi.mock('@react-three/drei', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@react-three/drei');
  return { ...actual, Cloud: () => null };
});

const { CurvedLandscapeElements } = await import('../components/rower3d/bankComponents');
const { AnimationProvider } = await import('../components/rower3d/AnimationContext');

const straightRoute = () =>
  new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0, 0, -1000),
    new THREE.Vector3(0, 0, -2000),
  ]);

/**
 * Duck-typed rather than `instanceof`: the renderer's objects do not come from
 * the same `three` module instance the test imports.
 */
const isMesh = (object: THREE.Object3D): object is THREE.Mesh => (object as THREE.Mesh).isMesh === true;

const hex = (mesh: THREE.Mesh) =>
  `#${(mesh.material as THREE.MeshPhysicalMaterial).color.getHexString()}`;

describe('a village house on the bank', () => {
  let uninstallCanvasMock: () => void;
  beforeAll(() => {
    uninstallCanvasMock = installCanvasMock();
  });
  afterAll(() => uninstallCanvasMock());

  it('takes its wall and roof colours from the config', async () => {
    const renderer = await ReactThreeTestRenderer.create(
      <AnimationProvider>
        <CurvedLandscapeElements
          curve={straightRoute()}
          chunkProgress={0}
          mountProgress={0.1}
          viewDistance={200}
        />
      </AnimationProvider>,
    );

    const { wallMaterial, roofColor } = SCENE_CONFIG.architecture;
    const houses: THREE.Object3D[] = [];
    (renderer.scene.instance as unknown as THREE.Scene).traverse((object) => {
      const meshes = object.children.filter(isMesh);
      if (meshes.some((m) => m.geometry.type === 'BoxGeometry' && hex(m) === wallMaterial.color)) {
        houses.push(object);
      }
    });

    expect(houses.length, 'the bank built no house with the configured wall').toBeGreaterThan(0);
    for (const house of houses) {
      const roof = house.children
        .filter(isMesh)
        .find((m) => m.geometry.type === 'ConeGeometry');
      expect(roof, 'a house has no roof').toBeDefined();
      expect(hex(roof!)).toBe(roofColor);
    }

    await renderer.unmount();
  });
});
