import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';
import * as THREE from 'three';
import ReactThreeTestRenderer from '@react-three/test-renderer';
import { installCanvasMock } from './canvasMock';
import { SCENE_CONFIG } from '../components/rower3d/themeConfig';

/**
 * Issue #333 — a forest is a handful of draw calls.
 *
 * The bank trees were eleven meshes each, which is why there could only be
 * forty of them on the demo route. Each species is one `InstancedMesh` now, so
 * what is asserted is the thing that makes a planted bank affordable: the
 * number of meshes does not grow with the number of trees.
 *
 * The browser-side half of this - the renderer's own draw-call count with the
 * foliage on and off - is in `scenery-kit-budgets.spec.ts`.
 */
vi.mock('@react-three/drei', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@react-three/drei');
  return { ...actual, Cloud: () => null };
});

const { BankFoliage, BANK_FOLIAGE_NAME, FOLIAGE_CULL_FRAME_INTERVAL } = await import(
  '../components/rower3d/foliageComponents'
);
const { CurvedLandscapeElements, LANDSCAPE_ELEMENT_NAME } = await import(
  '../components/rower3d/bankComponents'
);
const { AnimationProvider } = await import('../components/rower3d/AnimationContext');

const straightRoute = (length: number) =>
  new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0, 0, -length / 2),
    new THREE.Vector3(0, 0, -length),
  ]);

/** Duck-typed: the renderer's objects come from its own `three` instance. */
const isInstanced = (o: THREE.Object3D): o is THREE.InstancedMesh =>
  (o as THREE.InstancedMesh).isInstancedMesh === true;

const mount = async (element: React.ReactElement) => {
  const renderer = await ReactThreeTestRenderer.create(<AnimationProvider>{element}</AnimationProvider>);
  const all = () => {
    const found: THREE.Object3D[] = [];
    (renderer.scene.instance as unknown as THREE.Scene).traverse((o) => found.push(o));
    return found;
  };
  const foliage = () => all().filter(isInstanced).filter((m) => m.name.startsWith(`${BANK_FOLIAGE_NAME}:`));
  const tick = async (frames: number) => {
    await ReactThreeTestRenderer.act(async () => {
      await renderer.advanceFrames(frames, 1 / 60);
    });
  };
  return { renderer, all, foliage, tick };
};

describe('BankFoliage', () => {
  let uninstallCanvasMock: () => void;
  beforeAll(() => {
    uninstallCanvasMock = installCanvasMock();
  });
  afterAll(() => uninstallCanvasMock());
  afterEach(() => {
    delete window.__ROWER3D_SCENERY_CLEARANCE;
    delete window.__ROWER3D_FOLIAGE;
  });

  it('draws 400 trees and 4,000 with the same handful of meshes', async () => {
    const counts = [];
    for (const length of [4_000, 40_000]) {
      const scene = await mount(<BankFoliage curve={straightRoute(length)} viewDistance={600} />);
      const meshes = scene.foliage();
      const trees = meshes.reduce((sum, m) => sum + m.instanceMatrix.count, 0);
      counts.push({ meshes: meshes.length, trees });
      await scene.renderer.unmount();
    }

    expect(counts[0].trees).toBeGreaterThanOrEqual(400);
    expect(counts[1].trees).toBeGreaterThan(counts[0].trees * 8);
    for (const { meshes } of counts) {
      expect(meshes).toBeGreaterThan(0);
      expect(meshes).toBeLessThanOrEqual(SCENE_CONFIG.trees.species.length);
    }
  });

  it('draws each species in its configured colour, cut out by a leaf texture', async () => {
    const scene = await mount(<BankFoliage curve={straightRoute(4_000)} viewDistance={600} />);

    for (const mesh of scene.foliage()) {
      const material = mesh.material as THREE.MeshLambertMaterial;
      const type = mesh.name.slice(BANK_FOLIAGE_NAME.length + 1);
      const entry = SCENE_CONFIG.trees.species.find((s) => s.type === type)!;
      expect(`#${material.color.getHexString()}`).toBe(entry.color);
      expect(material.map).toBeTruthy();
      expect(material.alphaTest).toBeGreaterThanOrEqual(0.5);
      expect(mesh.castShadow).toBe(true);
    }
    await scene.renderer.unmount();
  });

  it('draws only the trees within sight of the boat, from the frame loop', async () => {
    const boat = { current: new THREE.Vector3(0, 0, -2000) };
    const scene = await mount(
      <BankFoliage curve={straightRoute(4_000)} viewDistance={300} positionRef={boat} />,
    );
    const planted = scene.foliage().reduce((sum, m) => sum + m.count, 0);

    await scene.tick(FOLIAGE_CULL_FRAME_INTERVAL);
    const near = scene.foliage().reduce((sum, m) => sum + m.count, 0);
    expect(near).toBeGreaterThan(0);
    expect(near).toBeLessThan(planted / 4);

    // Rowed off the end of the route: nothing left in sight.
    boat.current.set(0, 0, -9000);
    await scene.tick(FOLIAGE_CULL_FRAME_INTERVAL);
    expect(scene.foliage().reduce((sum, m) => sum + m.count, 0)).toBe(0);
    await scene.renderer.unmount();
  });

  it('publishes how many trees it planted and how near the water the nearest stands', async () => {
    window.__PLAYWRIGHT_TESTING = true;
    try {
      const boat = { current: new THREE.Vector3(0, 0, -1000) };
      const scene = await mount(
        <BankFoliage curve={straightRoute(4_000)} viewDistance={600} positionRef={boat} />,
      );
      await scene.tick(FOLIAGE_CULL_FRAME_INTERVAL);

      const published = window.__ROWER3D_FOLIAGE!;
      expect(published.trees).toBe(scene.foliage().reduce((sum, m) => sum + m.instanceMatrix.count, 0));
      expect(published.meshes).toBe(scene.foliage().length);
      expect(published.drawn).toBe(scene.foliage().reduce((sum, m) => sum + m.count, 0));
      expect(published.drawn).toBeLessThan(published.trees);
      const clearance = window.__ROWER3D_SCENERY_CLEARANCE?.foliage;
      expect(clearance?.count).toBe(published.trees);
      expect(clearance!.nearestM).toBeGreaterThanOrEqual(clearance!.marginM - 1e-6);
      await scene.renderer.unmount();
    } finally {
      delete window.__PLAYWRIGHT_TESTING;
    }
  });

  it('draws nothing without a route', async () => {
    const scene = await mount(<BankFoliage curve={null} viewDistance={600} />);
    expect(scene.foliage()).toEqual([]);
    await scene.renderer.unmount();
  });
});

describe('the procedural landscape', () => {
  let uninstallCanvasMock: () => void;
  beforeAll(() => {
    uninstallCanvasMock = installCanvasMock();
  });
  afterAll(() => uninstallCanvasMock());
  afterEach(() => {
    delete window.__VIRTUALROW_FOLIAGE;
  });

  const landscape = (length = 6_000) => (
    <CurvedLandscapeElements
      curve={straightRoute(length)}
      chunkProgress={0.5}
      mountProgress={0.5}
      viewDistance={600}
    />
  );

  it('plants its trees as billboards, not as stacks of cones', async () => {
    const scene = await mount(landscape());

    expect(scene.foliage().length).toBeGreaterThan(0);
    const cones = scene
      .all()
      .filter((o) => (o as THREE.Mesh).isMesh && (o as THREE.Mesh).geometry.type === 'ConeGeometry');
    // Roofs and mountains are cones; a cone tree came with a cylinder trunk
    // and flared roots, and there are no cylinders left on the bank at all.
    const cylinders = scene
      .all()
      .filter((o) => (o as THREE.Mesh).isMesh && (o as THREE.Mesh).geometry.type === 'CylinderGeometry');
    expect(cylinders).toEqual([]);
    expect(cones.length).toBeGreaterThan(0);
    await scene.renderer.unmount();
  });

  it('mounts a house or mountain by where it stands, not by its index in the list', async () => {
    // A 6 km route mounted around its middle: with progress read from the
    // index (`index * 0.02 / 0.6`), the elements mounted were the fifteenth to
    // the thirtieth of each side's list - wherever those happened to be.
    const scene = await mount(landscape());
    const curve = straightRoute(6_000);
    const mountedZ = scene
      .all()
      .filter((o) => o.name === LANDSCAPE_ELEMENT_NAME)
      .map((o) => o.position.z);

    expect(mountedZ.length).toBeGreaterThan(0);
    const centre = curve.getPointAt(0.5).z;
    for (const z of mountedZ) {
      // Within the mount window, 0.15 of the route either side of 0.5.
      expect(Math.abs(z - centre)).toBeLessThanOrEqual(0.15 * 6_000 + 1);
    }
    await scene.renderer.unmount();
  });

  it('leaves the foliage out when a spec measures what it costs', async () => {
    window.__VIRTUALROW_FOLIAGE = false;
    const scene = await mount(landscape());
    expect(scene.foliage()).toEqual([]);
    await scene.renderer.unmount();
  });
});
