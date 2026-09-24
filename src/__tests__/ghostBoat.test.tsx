import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import * as THREE from 'three';
import ReactThreeTestRenderer from '@react-three/test-renderer';
import { installCanvasMock } from './canvasMock';

vi.hoisted(() => {
  // The procedural scull, which loads nothing. The GLB path is the same group,
  // and the placement under test is the group's (`boatComponents.test.tsx`).
  window.__PLAYWRIGHT_TESTING = true;
});

const { GhostBoat, GHOST_GROUP_NAME } = await import('../components/rower3d/GhostBoat');
const { paceGhost, GHOST_LANE_OFFSET_M } = await import('../components/rower3d/ghost');

/**
 * Issue #338 — the ghost, on the water.
 *
 * `ghost.test.ts` covers where the ghost should be at a given second. This is
 * that arriving in the scene: the frame loop that turns a distance into a
 * point on the route, a lane beside the centreline, and a heading.
 */

/** A straight 1 km route along +Z, so a distance is easy to reason about. */
const straightRoute = () =>
  new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0, 0, 500),
    new THREE.Vector3(0, 0, 1000),
  ]);

let uninstallCanvas: () => void;

beforeAll(() => {
  uninstallCanvas = installCanvasMock();
});

afterAll(() => {
  uninstallCanvas();
});

const mountGhost = async (elapsedSeconds: number, playing = true) => {
  const curve = straightRoute();
  const elapsedSecondsRef = { current: elapsedSeconds };
  const length = curve.getLength();

  const renderer = await ReactThreeTestRenderer.create(
    <GhostBoat
      source={paceGhost(120)} // 2:00/500 m — 4.1666 m/s
      routeCurve={curve}
      curveDistances={curve.getLengths(200)}
      curveLength={length}
      totalDistanceMeters={1000}
      elapsedSecondsRef={elapsedSecondsRef}
      playing={playing}
    />,
  );

  await renderer.advanceFrames(2, 1 / 60);
  const group = renderer.scene.findByProps({ name: GHOST_GROUP_NAME });
  return { renderer, group, elapsedSecondsRef };
};

describe('the ghost boat in the scene', () => {
  it('is placed down the route by the time that has passed', async () => {
    const early = await mountGhost(12); // ~50 m
    const late = await mountGhost(120); // ~500 m

    expect(late.group.instance.position.z).toBeGreaterThan(
      early.group.instance.position.z + 100,
    );
  });

  // Two boats on one line is one boat with z-fighting.
  it('rows its own lane, beside the centreline', async () => {
    const { group } = await mountGhost(60);

    expect(Math.abs(group.instance.position.x)).toBeCloseTo(GHOST_LANE_OFFSET_M, 1);
  });

  /**
   * On the line at the gun, give or take a frame.
   *
   * Not exactly zero: a playing ghost fills the gap between the erg's packets
   * on the frame clock, so two frames in it has rowed two frames' worth. What
   * matters is that it has not been placed somewhere down the course.
   */
  it('starts on the line, like everything else does', async () => {
    const { group } = await mountGhost(0);

    expect(group.instance.position.z).toBeLessThan(1);
    expect(group.instance.position.z).toBeGreaterThanOrEqual(0);
  });

  // The ghost runs on the row's clock, so a paused row is a paused ghost -
  // otherwise a rower who stopped for a drink would come back to a race lost.
  it('does not row on while the row is stopped', async () => {
    const { renderer, group } = await mountGhost(30, false);
    const before = group.instance.position.z;

    await renderer.advanceFrames(60, 1 / 60);

    expect(group.instance.position.z).toBeCloseTo(before, 3);
  });

  /**
   * Between the erg's packets the ghost runs on the frame clock, so it does
   * not step down the course a length at a time (`followClock`).
   */
  it('keeps moving between the erg’s packets', async () => {
    const { renderer, group } = await mountGhost(30, true);
    const before = group.instance.position.z;

    await renderer.advanceFrames(30, 1 / 60);

    expect(group.instance.position.z).toBeGreaterThan(before);
  });
});
