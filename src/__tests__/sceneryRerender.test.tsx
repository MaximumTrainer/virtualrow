import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { Profiler } from 'react';
import * as THREE from 'three';
import ReactThreeTestRenderer from '@react-three/test-renderer';
import { installCanvasMock } from './canvasMock';

/**
 * Issue #331 — steady rowing does not re-render the scenery.
 *
 * `RowerScene` called `setSceneryState` every 0.1 s, and the landscape read it
 * as a `boatProgress` prop. So moving the boat *necessarily* re-rendered the
 * bank: the component answered by re-running its placement filters and
 * rebuilding JSX for hundreds of trees and houses, ten times a second, on a
 * boat doing nothing but going straight. That is what the periodic 100–300 ms
 * frames in `frameStats.p95Ms` were, and why they showed up independently of
 * GPU load.
 *
 * Counting commits is the only way to state it: a scene graph that looks right
 * says nothing about how many times React rebuilt it to get there, which is
 * exactly why this went unnoticed while every other scene test passed.
 *
 * Measured on the landscape itself rather than on the whole scene. The scene
 * re-renders for reasons that have nothing to do with scenery — the stroke
 * phase changes several times a stroke — and a count that swept those in would
 * answer a different question from the one #331 asked.
 */
vi.mock('@react-three/drei', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@react-three/drei');
  return { ...actual, Cloud: () => null };
});

const { CurvedLandscapeElements, LANDSCAPE_ELEMENT_NAME } = await import(
  '../components/rower3d/bankComponents'
);
const { AnimationProvider } = await import('../components/rower3d/AnimationContext');

/** A straight 2 km route, so a boat's distance from a tree is easy to reason about. */
const straightRoute = () =>
  new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0, 0, -1000),
    new THREE.Vector3(0, 0, -2000),
  ]);

describe('steady rowing', () => {
  let uninstallCanvasMock: () => void;
  beforeAll(() => {
    uninstallCanvasMock = installCanvasMock();
  });
  afterAll(() => uninstallCanvasMock());

  /**
   * Mount the bank with a boat the test can move, and count its commits.
   *
   * `mountProgress` 0.15 either side of 0.1 covers the first 500 m of the 2 km
   * route, so the boat can row inside the mounted window and the cull is what
   * decides what is drawn — which is the thing under test. Mounting is a
   * separate, far slower decision (#331).
   */
  const mountBank = async (viewDistance = 200) => {
    const boat = { current: new THREE.Vector3(0, 0, 0) };
    let commits = 0;

    const renderer = await ReactThreeTestRenderer.create(
      <AnimationProvider>
        <Profiler
          id="bank"
          onRender={() => {
            commits += 1;
          }}
        >
          <CurvedLandscapeElements
            curve={straightRoute()}
            positionRef={boat}
            chunkProgress={0}
            mountProgress={0.1}
            viewDistance={viewDistance}
          />
        </Profiler>
      </AnimationProvider>,
    );

    /**
     * The per-element groups the cull writes `visible` on. By name, since the
     * trees beside them are instanced and culled per instance (#333).
     */
    const elements = (): THREE.Object3D[] => {
      const scene = renderer.scene.instance as unknown as THREE.Scene;
      const found: THREE.Object3D[] = [];
      scene.traverse((object) => {
        if (object.name === LANDSCAPE_ELEMENT_NAME) found.push(object);
      });
      return found;
    };

    const rowTo = async (z: number) => {
      boat.current.set(0, 0, z);
      await ReactThreeTestRenderer.act(async () => {
        await renderer.advanceFrames(12, 1 / 60);
      });
    };

    return { renderer, rowTo, elements, commitsSoFar: () => commits };
  };

  it('draws what is near the boat and not what is far from it', async () => {
    const bank = await mountBank(200);

    await bank.rowTo(0);
    const drawnAtStart = bank.elements().filter((o) => o.visible);
    expect(drawnAtStart.length, 'nothing was drawn at the start').toBeGreaterThan(0);

    // Four hundred metres down the route with a 200 m view distance: nothing
    // that stood beside the boat at the start is still in range.
    await bank.rowTo(-400);
    const nearStartStillDrawn = bank
      .elements()
      .filter((object) => object.visible && object.position.z > -180);

    expect(
      nearStartStillDrawn.length,
      'the bank by the start line is still drawn four hundred metres later',
    ).toBe(0);

    await bank.renderer.unmount();
  });

  it('changes what is drawn without re-rendering to do it', async () => {
    const bank = await mountBank(200);

    await bank.rowTo(0);
    const afterMount = bank.commitsSoFar();
    const atStart = bank
      .elements()
      .filter((object) => object.visible)
      .map((object) => object.position.z);

    await bank.rowTo(-400);
    const later = bank
      .elements()
      .filter((object) => object.visible)
      .map((object) => object.position.z);

    // The premise: something really did change. Without it the commit count
    // below would be satisfied by a cull that never ran at all.
    expect(later, 'the cull did not react to the boat moving').not.toEqual(atStart);

    expect(
      bank.commitsSoFar() - afterMount,
      'moving the boat still rebuilds the bank',
    ).toBe(0);

    await bank.renderer.unmount();
  });
});
