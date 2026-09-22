import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import * as THREE from 'three';
import ReactThreeTestRenderer from '@react-three/test-renderer';
import { installCanvasMock } from './canvasMock';
import { AnimationProvider } from '../components/rower3d/AnimationContext';

/** A boat position ref, the shape the followers read (#331). */
const boatAt = (x: number, z: number): React.RefObject<THREE.Vector3> => ({
  current: new THREE.Vector3(x, 0, z),
});

/**
 * Issue #325 — the sky is the one thing the fog must not touch.
 *
 * Fog fades distance into a flat colour, which is the point. The skydome and
 * the horizon silhouette both sit far beyond the fog's far plane, so fogging
 * them paints them out completely: the scene loses its sun, its gradient and
 * the skyline the fade is supposed to be revealing. three fogs every material
 * by default, so both have to say otherwise.
 */
vi.mock('@react-three/drei', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@react-three/drei');
  // A group rather than null, so a test can count how many clouds a tier asked
  // for. It carries no material, so the fog cases below are unaffected.
  // Cloud and Billboard are stubbed as named groups so a test can count the
  // clouds a tier asked for and see that the silhouette is inside a billboard.
  // Neither carries a material, so the fog cases below are unaffected.
  return {
    ...actual,
    Cloud: () => <group name="CloudSprite" />,
    Billboard: ({ children, ...props }: { children?: React.ReactNode }) => (
      <group name={`Billboard:${JSON.stringify(props)}`}>{children}</group>
    ),
  };
});

const { PhotorealisticSkydome, HorizonSilhouette, CLOUD_LAYER_NAME } = await import(
  '../components/rower3d/skyComponents'
);

/** Every material in a mounted tree, paired with whether it takes fog. */
const materialsOf = async (element: React.ReactElement) => {
  const renderer = await ReactThreeTestRenderer.create(element);
  const found: Array<{ type: string; fog: boolean }> = [];
  (renderer.scene.instance as unknown as THREE.Scene).traverse((object) => {
    const mesh = object as THREE.Mesh;
    const materials = Array.isArray(mesh.material)
      ? mesh.material
      : mesh.material
        ? [mesh.material]
        : [];
    for (const material of materials) {
      found.push({
        type: material.type,
        fog: (material as THREE.MeshBasicMaterial).fog === true,
      });
    }
  });
  return { renderer, found };
};

describe('the sky stands outside the fog', () => {
  let uninstallCanvasMock: () => void;
  beforeAll(() => {
    uninstallCanvasMock = installCanvasMock();
  });
  afterAll(() => uninstallCanvasMock());

  it('keeps the skydome out of it', async () => {
    const { renderer, found } = await materialsOf(
      <PhotorealisticSkydome theme="willowbrook" positionRef={boatAt(0, 0)} performanceMode="high" />,
    );

    expect(found.length, 'the skydome drew nothing').toBeGreaterThan(0);
    expect(
      found.filter((m) => m.fog),
      'a skydome material would be painted out by the fog',
    ).toEqual([]);

    await renderer.unmount();
  });

  it('keeps the horizon silhouette out of it', async () => {
    const { renderer, found } = await materialsOf(
      <HorizonSilhouette theme="willowbrook" positionRef={boatAt(0, 0)} />,
    );

    expect(found.length, 'the silhouette drew nothing').toBeGreaterThan(0);
    expect(
      found.filter((m) => m.fog),
      'the skyline the fade is meant to reveal would be faded out with it',
    ).toEqual([]);

    await renderer.unmount();
  });
});

/**
 * Issue #326 — the sky comes round the bend with the boat.
 *
 * The cloud layer, the horizon silhouette and the caustics all sat at
 * `[0, y, boatZ]`. The route curve moves the boat in X as well, so on any bend
 * the sky slid sideways relative to the camera, and on a looped course it ended
 * up behind the boat entirely.
 */
describe('the sky follows the boat', () => {
  let uninstall: () => void;
  beforeAll(() => {
    uninstall = installCanvasMock();
  });
  afterAll(() => uninstall());

  /**
   * The sky follows the boat in the frame loop now (#331), so the test has to
   * run frames. `AnimationProvider` owns the single `useFrame` the followers
   * subscribe to, which is the real path rather than a stand-in for it.
   */
  const skyAt = async (x: number, z: number, mode: 'low' | 'auto' | 'high' = 'high') => {
    const renderer = await ReactThreeTestRenderer.create(
      <AnimationProvider>
        <PhotorealisticSkydome theme="willowbrook" positionRef={boatAt(x, z)} performanceMode={mode} />
      </AnimationProvider>,
    );
    await renderer.advanceFrames(2, 1 / 60);
    let layer: THREE.Object3D | undefined;
    (renderer.scene.instance as unknown as THREE.Scene).traverse((o) => {
      if (o.name === CLOUD_LAYER_NAME) layer = o;
    });
    return { renderer, layer };
  };

  it('puts the clouds over the boat, not over the origin', async () => {
    const { renderer, layer } = await skyAt(420, -1800);

    expect(layer, 'no cloud layer to find').toBeDefined();
    // The drift is a few metres of sideways wander; the boat is 420 m out.
    expect(
      layer!.position.x,
      'the sky stayed at x=0 while the boat rounded a bend',
    ).toBeGreaterThan(400);
    expect(layer!.position.z).toBeCloseTo(-1800, 3);

    await renderer.unmount();
  });

  // The scene mounts before the first frame has run, so a follower can be
  // asked where to go before there is anywhere to go. The origin is not an
  // answer: it is a real place on the route, and snapping the sky to it would
  // put the clouds over the start line for as long as it lasted.
  it('leaves the sky alone when there is no boat to follow yet', async () => {
    const renderer = await ReactThreeTestRenderer.create(
      <AnimationProvider>
        <PhotorealisticSkydome
          theme="willowbrook"
          positionRef={{ current: null }}
          performanceMode="high"
        />
      </AnimationProvider>,
    );
    await renderer.advanceFrames(2, 1 / 60);

    let layer: THREE.Object3D | undefined;
    (renderer.scene.instance as unknown as THREE.Scene).traverse((o) => {
      if (o.name === CLOUD_LAYER_NAME) layer = o;
    });

    expect(layer, 'no cloud layer to find').toBeDefined();
    expect(layer!.position.x, 'the sky moved to somewhere no boat has been').toBe(0);
    expect(layer!.position.z).toBe(0);

    await renderer.unmount();
  });

  // Stated against the high tier rather than on its own: "no clouds" also
  // describes a sky that failed to build, and that is not what is being
  // claimed.
  it('draws clouds for high and none for low', async () => {
    const high = await skyAt(0, 0);
    const low = await skyAt(0, 0, 'low');

    expect(high.layer?.children.length, 'the sky built no clouds at all').toBeGreaterThan(0);
    expect(low.layer?.children ?? [], 'the low tier is paying for clouds').toHaveLength(0);

    await high.renderer.unmount();
    await low.renderer.unmount();
  });
});

/**
 * Issue #326 — the silhouette faces the rower.
 *
 * It is a flat shape standing kilometres down the route, and a rower reaches
 * it from whatever heading the bend left them on; unturned, it shows its edge.
 * `lockX` and `lockZ` keep it upright so it yaws about Y like a horizon does
 * rather than tipping to face a camera that is looking slightly down.
 */
describe('the horizon silhouette', () => {
  let uninstall: () => void;
  beforeAll(() => {
    uninstall = installCanvasMock();
  });
  afterAll(() => uninstall());

  it('is billboarded to the camera, and only about Y', async () => {
    const renderer = await ReactThreeTestRenderer.create(
      <HorizonSilhouette theme="willowbrook" positionRef={boatAt(0, 0)} />,
    );

    const billboards: string[] = [];
    (renderer.scene.instance as unknown as THREE.Scene).traverse((o) => {
      if (o.name.startsWith('Billboard:')) billboards.push(o.name);
    });

    expect(billboards, 'the silhouette is not billboarded').toHaveLength(1);
    expect(billboards[0], 'the silhouette can tip out of upright').toContain('"lockX":true');
    expect(billboards[0]).toContain('"lockZ":true');

    await renderer.unmount();
  });

  it('keeps the shape inside the billboard, not beside it', async () => {
    const renderer = await ReactThreeTestRenderer.create(
      <HorizonSilhouette theme="willowbrook" positionRef={boatAt(0, 0)} />,
    );

    let billboard: THREE.Object3D | undefined;
    (renderer.scene.instance as unknown as THREE.Scene).traverse((o) => {
      if (o.name.startsWith('Billboard:')) billboard = o;
    });

    expect(billboard!.children.length, 'the billboard turns nothing').toBeGreaterThan(0);

    await renderer.unmount();
  });
});
