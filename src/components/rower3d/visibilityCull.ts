import * as THREE from 'three';

// ============================================================================
// WHAT IS WORTH DRAWING, DECIDED WITHOUT REACT (#331)
//
// `RowerScene` called `setSceneryState` ten times a second. Every one of those
// re-rendered the terrain, the pines, the ground cover, the skydome, the
// horizon silhouette, the caustics light and the GLB scenery — and
// `SceneryModels` answered by rebuilding its JSX, which mounted and unmounted
// `<primitive>` groups as the boat moved. That is a scene graph edit ten times
// a second, and it is what the 100–300 ms frames in `frameStats.p95Ms` were.
//
// None of it needed React. Which objects are near the boat is a distance test,
// and a distance test can write `object.visible` from inside `useFrame` where
// nothing re-renders at all. React is left with the one decision that really
// does change the tree: which chunk of the route the boat is on.
//
// Pure, so the arithmetic is testable without a canvas.
// ============================================================================

/**
 * Mark which of `centres` lie within `range` of the boat.
 *
 * `centres` is xz pairs — y is ignored, because the scenery stands on a bank
 * whose height has nothing to do with whether it is worth drawing. Writes into
 * `out` rather than allocating: this runs inside `useFrame`, and a fresh array
 * per frame is the kind of garbage that shows up as a stutter rather than as a
 * slowdown. Returns `out` for convenience.
 */
export const cullByDistance = (
  centres: Float32Array,
  boat: THREE.Vector3,
  range: number,
  out: Uint8Array,
): Uint8Array => {
  const rangeSquared = range * range;
  for (let i = 0; i < out.length; i += 1) {
    const dx = centres[i * 2] - boat.x;
    const dz = centres[i * 2 + 1] - boat.z;
    out[i] = dx * dx + dz * dz <= rangeSquared ? 1 : 0;
  }
  return out;
};

/**
 * Which chunk of the route a progress falls in.
 *
 * The last chunk owns its own far end: at progress 1 the floor would give
 * `chunks`, one past the end, and the boat finishing a route is not a reason
 * to unmount the world.
 */
export const chunkIndexFor = (progress: number, chunks: number): number => {
  if (chunks <= 1) return 0;
  const clamped = THREE.MathUtils.clamp(progress, 0, 1);
  return Math.min(chunks - 1, Math.floor(clamped * chunks));
};

/**
 * The shortest gap between two scenery re-renders, in seconds.
 *
 * A chunk boundary is the only thing that changes the tree, and on a 1.5 km
 * chunk at racing pace they are six minutes apart. The floor is here for the
 * degenerate case — a very short route, or a boat sitting on a boundary — so
 * that crossing back and forth cannot turn into a re-render per frame.
 */
export const SCENERY_STATE_MIN_INTERVAL_SECONDS = 1;

/**
 * Whether the scenery tree should be rebuilt now.
 *
 * Both conditions have to hold: the boat has moved into a different chunk, and
 * enough time has passed since the last rebuild. Stated as a function so the
 * rule is somewhere a test can reach, rather than inline in a frame callback
 * where it was previously four floating-point comparisons nobody could check.
 */
export const shouldRebuildScenery = (
  chunk: number,
  lastChunk: number,
  elapsedSeconds: number,
  lastRebuildSeconds: number,
): boolean =>
  chunk !== lastChunk &&
  elapsedSeconds - lastRebuildSeconds >= SCENERY_STATE_MIN_INTERVAL_SECONDS;
