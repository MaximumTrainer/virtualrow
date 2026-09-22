import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import * as THREE from 'three';
import ReactThreeTestRenderer from '@react-three/test-renderer';
import { installCanvasMock } from './canvasMock';

/**
 * Issues #329 and #330 — the parts of the GLB scull the frame loop moves.
 *
 * The rower sat rigid while the oars swept and nobody noticed, because
 * `Rower3D` renders `RowingScull` under `IS_TEST_MODE` and `GltfScull`
 * otherwise — so the scull every real session uses was the one path
 * automation could not reach (#273). Mounting it directly gets past that, and
 * driving it from a stroke phase this test owns makes every pose exact rather
 * than whatever the clock happened to be at.
 *
 * The model matters as much as the mount: an empty `Group` makes every
 * `if (oars.left)` in the frame loop a no-op, and a test watching that would
 * pass whatever the code did. The mock builds the rig with the names
 * `scripts/build_crew.py` gives it.
 */
vi.mock('@react-three/drei', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@react-three/drei');
  const three = await vi.importActual<typeof THREE>('three');

  const buildRig = () => {
    const scene = new three.Group();
    // Which nodes this rig carries, so a test can hand the scene a model that
    // is missing them - see "a model with none of the nodes" below.
    const names = (globalThis as { __TEST_RIG_NODES?: string[] }).__TEST_RIG_NODES ?? [
      'LeftOar',
      'RightOar',
      'Seat',
      'Rower_Torso',
      'Rower_LeftArm',
      'Rower_RightArm',
      'LeftArm_Fore',
      'RightArm_Fore',
    ];
    for (const name of names) {
      const node = new three.Group();
      node.name = name;
      // Authored away from the origin, as the rig authors them, so the frame
      // loop has a real rest position to measure its offsets from.
      if (name.endsWith('Oar')) node.position.set(0, 0.3, 0);
      if (name === 'Seat') node.position.set(0, 0, 0.2);
      scene.add(node);
    }
    return { scene };
  };

  const useGLTF = Object.assign(
    (path: string | string[]) => (Array.isArray(path) ? path.map(buildRig) : buildRig()),
    { preload: () => undefined },
  );
  return { ...actual, Cloud: () => null, useGLTF };
});

const { GltfScull } = await import('../components/rower3d/boatComponents');
const {
  BLADE_CLEARANCE_M,
  BLADE_DEPTH_M,
  FEATHER_RAD,
  SLIDE_TRAVEL_M,
  STROKE_DRIVE_FRACTION,
  OAR_LEVER_RATIO,
} = await import('../components/rower3d/strokePose');

/** Mount the scull with a stroke phase this test drives. */
const mountAt = async (phase: number) => {
  const strokeCycleTRef = { current: phase };
  const renderer = await ReactThreeTestRenderer.create(
    <GltfScull cadence={30} strokeCycleTRef={strokeCycleTRef} crew="male" />,
  );

  /**
   * Advance to a stroke phase and copy out what the rig looks like there.
   *
   * Numbers, not nodes. A map of `Object3D`s holds live references, so reading
   * two phases and comparing them afterwards compares the second phase with
   * itself - which is how the first version of this test claimed the blade
   * never left the water while reporting the same figure on both sides.
   */
  const at = async (next: number) => {
    strokeCycleTRef.current = next;
    await ReactThreeTestRenderer.act(async () => {
      await renderer.advanceFrames(2, 1 / 60);
    });

    const pose: Record<string, { x: number; y: number; z: number; rx: number; ry: number; rz: number }> = {};
    (renderer.scene.instance as unknown as THREE.Scene).traverse((object) => {
      if (!object.name) return;
      pose[object.name] = {
        x: object.position.x,
        y: object.position.y,
        z: object.position.z,
        rx: object.rotation.x,
        ry: object.rotation.y,
        rz: object.rotation.z,
      };
    });
    return pose;
  };

  return { renderer, at };
};

/** Mid-drive and mid-recovery, which is where the two halves are unambiguous. */
const MID_DRIVE = STROKE_DRIVE_FRACTION / 2;
const MID_RECOVERY = STROKE_DRIVE_FRACTION + (1 - STROKE_DRIVE_FRACTION) / 2;

describe('the GLB scull', () => {
  let uninstallCanvasMock: () => void;
  beforeAll(() => {
    uninstallCanvasMock = installCanvasMock();
  });
  afterAll(() => uninstallCanvasMock());

  it('carries the rig it is going to animate', async () => {
    const scull = await mountAt(0);
    const nodes = await scull.at(0);

    for (const name of ['LeftOar', 'RightOar', 'Seat', 'Rower_Torso']) {
      expect(nodes[name], `no ${name} in the mounted scull`).toBeDefined();
    }

    await scull.renderer.unmount();
  });

  // #329. Before it, the blades swept over the water at a constant height and
  // squared throughout — the one thing a sculler never does.
  it('squares the blades on the drive and feathers them on the recovery', async () => {
    const scull = await mountAt(MID_DRIVE);

    const drive = await scull.at(MID_DRIVE);
    expect(drive.LeftOar.rz, 'the blade is feathered mid-drive').toBeCloseTo(0, 5);

    const recovery = await scull.at(MID_RECOVERY);
    expect(recovery.LeftOar.rz).toBeCloseTo(FEATHER_RAD, 5);

    await scull.renderer.unmount();
  });

  it('puts the blades in the water on the drive and clear of it on the recovery', async () => {
    const scull = await mountAt(MID_DRIVE);

    const rest = 0.3; // where the mock rig authors the oars
    const drive = await scull.at(MID_DRIVE);
    expect(drive.LeftOar.y).toBeCloseTo(rest - BLADE_DEPTH_M * OAR_LEVER_RATIO, 5);

    const recovery = await scull.at(MID_RECOVERY);
    expect(recovery.LeftOar.y).toBeCloseTo(rest + BLADE_CLEARANCE_M * OAR_LEVER_RATIO, 5);
    expect(
      recovery.LeftOar.y,
      'the blade does not come out of the water',
    ).toBeGreaterThan(drive.LeftOar.y);

    await scull.renderer.unmount();
  });

  // #330. The rig has always carried a Seat and nothing ever moved it, so the
  // rower's legs compressed while their seat stayed where it was - they shrank
  // and grew rather than sliding up and down the boat.
  it('slides the seat the length of the slide', async () => {
    const scull = await mountAt(0);

    const rest = 0.2; // where the mock rig authors the seat
    const atCatch = await scull.at(0);
    const atFinish = await scull.at(STROKE_DRIVE_FRACTION - 0.001);

    expect(atCatch.Seat.z, 'the seat is not back at the catch').toBeCloseTo(
      rest - SLIDE_TRAVEL_M,
      2,
    );
    expect(atFinish.Seat.z, 'the seat did not come up the slide').toBeCloseTo(rest, 2);
  });

  it('keeps the seat and the knees agreeing', async () => {
    // `seatPosition` is derived from `legCompression` rather than tracked
    // beside it, so a rower cannot end up sitting somewhere their legs do not.
    const scull = await mountAt(0);

    // A quarter of the way through the drive, not half: the legs have their
    // own window and it is the drive's first half, so by the midpoint they are
    // already down and the seat has arrived.
    const partWay = await scull.at(STROKE_DRIVE_FRACTION * 0.25);
    const rest = 0.2;
    expect(partWay.Seat.z).toBeGreaterThan(rest - SLIDE_TRAVEL_M);
    expect(partWay.Seat.z).toBeLessThan(rest);
  });

  it('sweeps the oars in opposite directions, as a sculler does', async () => {
    const scull = await mountAt(MID_DRIVE);
    const nodes = await scull.at(MID_DRIVE);

    expect(nodes.LeftOar.ry).toBeCloseTo(-nodes.RightOar.ry, 6);

    await scull.renderer.unmount();
  });

  /**
   * A crew model that does not carry the rig.
   *
   * Every node the frame loop touches is behind an `if`, and those guards are
   * the difference between a scull that is missing an oar and a scene that
   * throws sixty times a second. The GLB is downloaded at runtime and #266 and
   * #267 both set the precedent: an asset that disappoints does not take the
   * scene down with it.
   */
  it('animates nothing, and throws nothing, when the model has no rig', async () => {
    (globalThis as { __TEST_RIG_NODES?: string[] }).__TEST_RIG_NODES = [];
    try {
      const scull = await mountAt(0);
      const atCatch = await scull.at(0);
      const atFinish = await scull.at(STROKE_DRIVE_FRACTION - 0.001);

      expect(Object.keys(atCatch), 'the bare model grew nodes').toEqual([]);
      expect(Object.keys(atFinish)).toEqual([]);

      await scull.renderer.unmount();
    } finally {
      delete (globalThis as { __TEST_RIG_NODES?: string[] }).__TEST_RIG_NODES;
    }
  });

  it('moves the rower rather than leaving them rigid while the oars swing', async () => {
    const scull = await mountAt(0);

    const atCatch = await scull.at(0);
    const atFinish = await scull.at(STROKE_DRIVE_FRACTION - 0.001);

    expect(
      Math.abs(atFinish.Rower_Torso.rx - atCatch.Rower_Torso.rx),
      'the rower sat rigid while the boat rowed itself (#273)',
    ).toBeGreaterThan(0.1);
    expect(
      Math.abs(atFinish.Rower_LeftArm.rx - atCatch.Rower_LeftArm.rx),
      'the arms never drew in',
    ).toBeGreaterThan(0.1);

    await scull.renderer.unmount();
  });
});
