import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  SCENERY_MOUNT_RANGE_PROGRESS,
  SCENERY_REMOUNT_PROGRESS,
  SCENERY_STATE_MIN_INTERVAL_SECONDS,
  chunkIndexFor,
  cullByDistance,
  shouldRebuildScenery,
  withinMountRange,
} from '../components/rower3d/visibilityCull';

/**
 * Issue #331 — the scenery was culled by re-rendering.
 *
 * `setSceneryState` ran ten times a second and `SceneryModels` answered by
 * rebuilding its JSX, mounting and unmounting `<primitive>` groups as the boat
 * moved. This is the arithmetic that replaces it, in a form that can be
 * checked without a canvas.
 */

describe('cullByDistance', () => {
  /** Four points at 0, 10, 100 and 1000 metres out along +X. */
  const centres = new Float32Array([0, 0, 10, 0, 100, 0, 1000, 0]);
  const boat = new THREE.Vector3(0, 0, 0);

  it('marks the near ones and not the far ones', () => {
    const out = cullByDistance(centres, boat, 50, new Uint8Array(4));
    expect(Array.from(out)).toEqual([1, 1, 0, 0]);
  });

  it('measures from the boat, not from the origin', () => {
    const out = cullByDistance(centres, new THREE.Vector3(1000, 0, 0), 50, new Uint8Array(4));
    expect(Array.from(out)).toEqual([0, 0, 0, 1]);
  });

  it('ignores height, because a bank is not a reason to stop drawing', () => {
    const high = cullByDistance(centres, new THREE.Vector3(0, 900, 0), 50, new Uint8Array(4));
    expect(Array.from(high)).toEqual([1, 1, 0, 0]);
  });

  it('includes a point exactly at the range', () => {
    const out = cullByDistance(new Float32Array([30, 40]), boat, 50, new Uint8Array(1));
    expect(out[0], 'the boundary case falls outside').toBe(1);
  });

  it('measures across both axes rather than down one', () => {
    const diagonal = new Float32Array([40, 40]);
    expect(cullByDistance(diagonal, boat, 50, new Uint8Array(1))[0]).toBe(0);
    expect(cullByDistance(diagonal, boat, 60, new Uint8Array(1))[0]).toBe(1);
  });

  it('writes into the array it is given rather than allocating one a frame', () => {
    const out = new Uint8Array(4);
    expect(cullByDistance(centres, boat, 50, out)).toBe(out);
  });

  it('clears a mark that has gone out of range, rather than only setting them', () => {
    const out = new Uint8Array([1, 1, 1, 1]);
    cullByDistance(centres, boat, 5, out);
    expect(Array.from(out)).toEqual([1, 0, 0, 0]);
  });
});

describe('chunkIndexFor', () => {
  it('splits the route evenly', () => {
    expect(chunkIndexFor(0, 4)).toBe(0);
    expect(chunkIndexFor(0.24, 4)).toBe(0);
    expect(chunkIndexFor(0.25, 4)).toBe(1);
    expect(chunkIndexFor(0.5, 4)).toBe(2);
  });

  it('gives the last chunk its own far end', () => {
    // Without the clamp the floor returns `chunks` at progress 1, and finishing
    // a route would unmount the world.
    expect(chunkIndexFor(1, 4)).toBe(3);
    expect(chunkIndexFor(1, 1)).toBe(0);
  });

  it('holds at the ends when progress runs past them', () => {
    expect(chunkIndexFor(-0.5, 4)).toBe(0);
    expect(chunkIndexFor(2, 4)).toBe(3);
  });

  it('has one chunk when there is one chunk', () => {
    expect(chunkIndexFor(0.7, 1)).toBe(0);
    expect(chunkIndexFor(0.7, 0)).toBe(0);
  });
});

describe('shouldRebuildScenery', () => {
  it('rebuilds when the boat crosses into a new chunk', () => {
    expect(shouldRebuildScenery(2, 1, 0.5, 0.5, 100, 0)).toBe(true);
  });

  // A chunk boundary alone is not enough. #331's plan assumed the scenery was
  // instanced and all of it could stay mounted; it is not — a tree is a
  // `coneGeometry` — and mounting the whole route took the #272 traverse from
  // 412 uploaded geometries to 766, against a ceiling of 627.
  it('rebuilds when the boat rows out of the window it was mounted for', () => {
    expect(
      shouldRebuildScenery(1, 1, 0.5 + SCENERY_REMOUNT_PROGRESS * 1.01, 0.5, 100, 0),
      'the boat left its mounted window and nothing was rebuilt',
    ).toBe(true);
  });

  it('does not rebuild while the boat stays inside its window and its chunk', () => {
    expect(shouldRebuildScenery(1, 1, 0.51, 0.5, 100, 0)).toBe(false);
  });

  // Stated a hair past the threshold rather than on it: `0.5 - 0.05` is
  // 0.44999999999999996 in binary floating point, so an exact-boundary case
  // here would be testing the arithmetic of doubles, not the rule.
  it('rebuilds whichever way the boat is going', () => {
    const backwards = 0.5 - SCENERY_REMOUNT_PROGRESS * 1.01;
    expect(shouldRebuildScenery(1, 1, backwards, 0.5, 100, 0)).toBe(true);
  });

  it('refuses to rebuild twice inside the interval, however far the boat moved', () => {
    const justUnder = SCENERY_STATE_MIN_INTERVAL_SECONDS - 0.01;
    expect(shouldRebuildScenery(2, 1, 0.9, 0.1, justUnder, 0)).toBe(false);
    expect(
      shouldRebuildScenery(2, 1, 0.9, 0.1, SCENERY_STATE_MIN_INTERVAL_SECONDS, 0),
    ).toBe(true);
  });

  it('caps the rebuild rate at once a second', () => {
    expect(SCENERY_STATE_MIN_INTERVAL_SECONDS).toBe(1);
  });

  // The window has to be wider than the distance the boat can travel between
  // rebuilds, or it rows past the end of its own scenery.
  it('moves the window well before the boat reaches its edge', () => {
    expect(SCENERY_REMOUNT_PROGRESS).toBeLessThan(SCENERY_MOUNT_RANGE_PROGRESS);
  });
});

describe('withinMountRange', () => {
  it('mounts what is near the centre of the window', () => {
    expect(withinMountRange(0.5, 0.5)).toBe(true);
    expect(withinMountRange(0.5 + SCENERY_MOUNT_RANGE_PROGRESS / 2, 0.5)).toBe(true);
  });

  it('leaves out what is beyond it, on either side', () => {
    expect(withinMountRange(0.5 + SCENERY_MOUNT_RANGE_PROGRESS + 0.001, 0.5)).toBe(false);
    expect(withinMountRange(0.5 - SCENERY_MOUNT_RANGE_PROGRESS - 0.001, 0.5)).toBe(false);
  });

  it('keeps what sits exactly on the edge', () => {
    expect(withinMountRange(SCENERY_MOUNT_RANGE_PROGRESS, 0)).toBe(true);
  });
});
