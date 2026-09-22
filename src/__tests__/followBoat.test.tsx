import { describe, it, expect, vi } from 'vitest';
import { useRef } from 'react';
import * as THREE from 'three';
import ReactThreeTestRenderer from '@react-three/test-renderer';

/**
 * Issue #331 — the tiled bands ride the boat without a render.
 *
 * The terrain, the pines, the ground cover and the village are laid out
 * relative to the boat, so each is a group whose position is the boat's. That
 * position used to arrive as a `boatZ` prop pushed from `setSceneryState` ten
 * times a second, and every push re-rendered hundreds of instances to move one
 * group. A group's position is exactly what a frame loop should be writing.
 *
 * The cases that matter are the ones a scene actually hits: a follower mounted
 * before the first frame has produced a boat, and a surface that travels along
 * the route without taking the route's height with it.
 */
vi.mock('@react-three/drei', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@react-three/drei');
  return { ...actual, Cloud: () => null };
});

const { useFollowPoint, useFollowZ, useVector3Ref } = await import(
  '../components/rower3d/followBoat'
);
const { AnimationProvider } = await import('../components/rower3d/AnimationContext');

const FOLLOWER = 'Follower';

/** A group that follows `followRef`, mounted at `authored`. */
const Follower: React.FC<{
  followRef?: React.RefObject<THREE.Vector3 | null>;
  authored: [number, number, number];
  zOnly?: boolean;
}> = ({ followRef, authored, zOnly = false }) => {
  const groupRef = useRef<THREE.Group>(null);
  // Both hooks are called so the rules of hooks hold; only one is given a
  // target, which is how a component picks the follow it wants.
  useFollowPoint(groupRef, zOnly ? undefined : followRef);
  useFollowZ(groupRef, zOnly ? followRef : undefined);
  return <group ref={groupRef} name={FOLLOWER} position={authored} />;
};

const mount = async (element: React.ReactElement) => {
  const renderer = await ReactThreeTestRenderer.create(
    <AnimationProvider>{element}</AnimationProvider>,
  );
  const follower = () => {
    let found: THREE.Object3D | undefined;
    (renderer.scene.instance as unknown as THREE.Scene).traverse((object) => {
      if (object.name === FOLLOWER) found = object;
    });
    return found!;
  };
  const tick = async () => {
    await ReactThreeTestRenderer.act(async () => {
      await renderer.advanceFrames(2, 1 / 60);
    });
  };
  return { renderer, follower, tick };
};

describe('useFollowPoint', () => {
  it('puts the group where the boat is', async () => {
    const boat = { current: new THREE.Vector3(120, 3, -900) };
    const scene = await mount(<Follower followRef={boat} authored={[0, 0, 0]} />);

    await scene.tick();

    expect(scene.follower().position.toArray()).toEqual([120, 3, -900]);
    await scene.renderer.unmount();
  });

  it('keeps up as the boat moves, without a re-render', async () => {
    const boat = { current: new THREE.Vector3(0, 0, 0) };
    const scene = await mount(<Follower followRef={boat} authored={[0, 0, 0]} />);

    await scene.tick();
    boat.current.set(0, 1.5, -400);
    await scene.tick();

    expect(scene.follower().position.z).toBe(-400);
    expect(scene.follower().position.y).toBe(1.5);
    await scene.renderer.unmount();
  });

  // The scene mounts before the first frame has run, so a follower can be
  // asked where to go before there is anywhere to go. The origin is not an
  // answer — it is a real place on the route, and snapping to it would park
  // the scenery on the start line for as long as it lasted.
  it('stays where it was authored while there is no boat to follow', async () => {
    const scene = await mount(
      <Follower followRef={{ current: null }} authored={[7, 8, 9]} />,
    );

    await scene.tick();

    expect(scene.follower().position.toArray()).toEqual([7, 8, 9]);
    await scene.renderer.unmount();
  });

  it('stays put when it was given nothing to follow at all', async () => {
    const scene = await mount(<Follower authored={[7, 8, 9]} />);

    await scene.tick();

    expect(scene.follower().position.toArray()).toEqual([7, 8, 9]);
    await scene.renderer.unmount();
  });
});

describe('useFollowZ', () => {
  // The flat water and the reflection plane travel along the route at a height
  // of their own. Copying the whole vector would drop them to the follow
  // point's Y, which is the relief under the boat and not where water lives.
  it('travels along the route without taking the route height with it', async () => {
    const boat = { current: new THREE.Vector3(120, 3, -900) };
    const scene = await mount(
      <Follower followRef={boat} authored={[0, -0.1, 0]} zOnly />,
    );

    await scene.tick();

    const { x, y, z } = scene.follower().position;
    expect(z).toBe(-900);
    expect(y, 'the water sank to the height of the ground under the boat').toBe(-0.1);
    expect(x, 'the water slid sideways with the boat').toBe(0);
    await scene.renderer.unmount();
  });

  it('stays where it was authored while there is no boat to follow', async () => {
    const scene = await mount(
      <Follower followRef={{ current: null }} authored={[0, -0.1, 5]} zOnly />,
    );

    await scene.tick();

    expect(scene.follower().position.z).toBe(5);
    await scene.renderer.unmount();
  });
});

describe('useVector3Ref', () => {
  it('hands back the same vector across renders rather than a new one each time', async () => {
    const seen: Array<THREE.Vector3 | null> = [];
    const Probe: React.FC<{ tag: number }> = () => {
      seen.push(useVector3Ref().current);
      return <group />;
    };

    const renderer = await ReactThreeTestRenderer.create(<Probe tag={1} />);
    await renderer.update(<Probe tag={2} />);

    expect(seen.length, 'the probe rendered only once').toBeGreaterThan(1);
    expect(seen[0], 'no vector was allocated').toBeInstanceOf(THREE.Vector3);
    expect(seen[1], 'a fresh vector every render is the allocation this avoids').toBe(
      seen[0],
    );

    await renderer.unmount();
  });
});
