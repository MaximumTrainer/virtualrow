import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import * as THREE from 'three';
import ReactThreeTestRenderer from '@react-three/test-renderer';
import { installCanvasMock } from './canvasMock';

/**
 * Issue #322 — the boat is carried by a group, not by a physics engine.
 *
 * `BoatKinematicController` used to write the boat's position and heading onto
 * a Rapier rigid body that had no colliders and that nothing ever collided
 * with. The engine read those two values back and wrote them onto the group
 * underneath — two and a quarter megabytes of WASM to copy a vector.
 *
 * This is that behaviour, tested where it now lives. It is also the test the
 * TDD guard asked for the moment `boatComponents.tsx` came off the coverage
 * exclusion list in #343: before that, this file could be changed without
 * anything noticing.
 */
vi.hoisted(() => {
  // The procedural scull, which loads nothing. The GLB path is the same group.
  window.__PLAYWRIGHT_TESTING = true;
});

const { BoatKinematicController } = await import('../components/rower3d/boatComponents');
const { BOAT_GROUP_NAME } = await import('../components/rower3d/constants');

const mountBoat = async (position: THREE.Vector3, rotation: number) => {
  const positionRef = { current: position };
  const rotationRef = { current: rotation };
  const strokeCycleTRef = { current: 0 };

  const renderer = await ReactThreeTestRenderer.create(
    <BoatKinematicController
      positionRef={positionRef}
      rotationRef={rotationRef}
      cadence={30}
      strokeCycleTRef={strokeCycleTRef}
    />,
  );

  const tick = async () => {
    await ReactThreeTestRenderer.act(async () => {
      await renderer.advanceFrames(1, 1 / 60);
    });
  };

  const boat = (): THREE.Object3D | undefined => {
    let found: THREE.Object3D | undefined;
    renderer.scene.instance.traverse((o) => {
      if (o.name === BOAT_GROUP_NAME) found = o;
    });
    return found;
  };

  return { renderer, tick, boat, positionRef, rotationRef };
};

describe('BoatKinematicController', () => {
  let uninstallCanvasMock: () => void;
  beforeAll(() => {
    uninstallCanvasMock = installCanvasMock();
  });
  afterAll(() => uninstallCanvasMock());

  it('puts the boat where the route says it is', async () => {
    const scene = await mountBoat(new THREE.Vector3(12, 0, -34), 0);
    await scene.tick();

    const boat = scene.boat();
    expect(boat, 'no group named for the boat').toBeDefined();
    expect(boat!.position.x).toBeCloseTo(12, 5);
    expect(boat!.position.z).toBeCloseTo(-34, 5);

    await scene.renderer.unmount();
  });

  // The heading is a rotation about Y. It used to be built into a quaternion
  // to hand to Rapier, which decomposed it again.
  it('points the boat the way the route is heading', async () => {
    const scene = await mountBoat(new THREE.Vector3(), Math.PI / 3);
    await scene.tick();

    expect(scene.boat()!.rotation.y).toBeCloseTo(Math.PI / 3, 5);

    await scene.renderer.unmount();
  });

  it('follows the refs as they move, frame to frame', async () => {
    const scene = await mountBoat(new THREE.Vector3(0, 0, 0), 0);
    await scene.tick();

    scene.positionRef.current.set(5, 0, 7);
    scene.rotationRef.current = 1.25;
    await scene.tick();

    const boat = scene.boat()!;
    expect(boat.position.x).toBeCloseTo(5, 5);
    expect(boat.position.z).toBeCloseTo(7, 5);
    expect(boat.rotation.y).toBeCloseTo(1.25, 5);

    await scene.renderer.unmount();
  });
});
