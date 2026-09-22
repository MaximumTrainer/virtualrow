import { useRef } from 'react';
import * as THREE from 'three';
import { useAnimationFrame } from './animationFrame';

// ============================================================================
// FOLLOWING THE BOAT WITHOUT RE-RENDERING (#331)
//
// The terrain, the pines, the ground cover and the village are tiled around
// the boat: each is a group whose position is the boat's, with the scenery
// laid out relative to it. That position arrived as a `boatZ` prop pushed from
// `setSceneryState` ten times a second, and every push re-rendered hundreds of
// instances to move one group.
//
// A group's position is exactly the kind of thing a frame loop should write.
// ============================================================================

/**
 * Keep `objectRef` sitting at `followRef`, updated every frame.
 *
 * Does nothing until both exist, which is the state during the first render
 * and after a route change — a follower with nothing to follow should stay
 * where it was authored rather than jump to the origin.
 */
export const useFollowPoint = (
  objectRef: React.RefObject<THREE.Object3D | null>,
  followRef: React.RefObject<THREE.Vector3 | null> | undefined,
): void => {
  useAnimationFrame(() => {
    const object = objectRef.current;
    const follow = followRef?.current;
    if (!object || !follow) return;
    object.position.copy(follow);
  });
};

/**
 * Keep `objectRef` at `followRef`'s Z, leaving X and Y as authored.
 *
 * The flat water, the reflection plane and the straight-route banks sit at a
 * height of their own and travel only along the route. Copying the whole
 * vector would drop them to the follow point's Y, which is the relief under
 * the boat and not where a water surface lives.
 */
export const useFollowZ = (
  objectRef: React.RefObject<THREE.Object3D | null>,
  followRef: React.RefObject<THREE.Vector3 | null> | undefined,
): void => {
  useAnimationFrame(() => {
    const object = objectRef.current;
    const follow = followRef?.current;
    if (!object || !follow) return;
    object.position.z = follow.z;
  });
};

/**
 * A `Vector3` that persists for the life of the component.
 *
 * `useRef(new THREE.Vector3())` allocates one on every render and throws all
 * but the first away; this allocates once. It matters because the scene mounts
 * several followers and re-renders them on every route change.
 */
export const useVector3Ref = (): React.RefObject<THREE.Vector3> => {
  const ref = useRef<THREE.Vector3 | null>(null);
  if (ref.current === null) ref.current = new THREE.Vector3();
  return ref as React.RefObject<THREE.Vector3>;
};
