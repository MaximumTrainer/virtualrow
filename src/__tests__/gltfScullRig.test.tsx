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
    // The real GLB wraps the whole scull in two ±90° rotations about X
    // (`scull_root` cancels the glTF exporter's Z-up → Y-up, `scull` is the
    // CadQuery assembly below it). The oar's local axes are decided by that
    // parent chain, so a mock that drops it animates about a different axis
    // than production and would have let #462 sit unnoticed. See
    // `scripts/build_crew.py:231-236` and the GLB inspection in #462's body.
    const sculRoot = new three.Group();
    sculRoot.name = 'scull_root';
    sculRoot.quaternion.set(-Math.SQRT1_2, 0, 0, Math.SQRT1_2);
    const scull = new three.Group();
    scull.name = 'scull';
    scull.quaternion.set(Math.SQRT1_2, 0, 0, Math.SQRT1_2);
    sculRoot.add(scull);
    scene.add(sculRoot);
    for (const name of names) {
      const node = new three.Group();
      node.name = name;
      // Authored away from the origin, as the rig authors them, so the frame
      // loop has a real rest position to measure its offsets from.
      if (name.endsWith('Oar')) {
        node.position.set(0, 0.3, 0);
        // Give the oar a blade sub-node along its local X axis (shaft axis),
        // as the real GLB does, so a test can watch where the blade ends up
        // in world space — not just read back the local rotation.
        const sign = name === 'LeftOar' ? -1 : 1;
        const blade = new three.Group();
        blade.name = `${name}_Blade`;
        blade.position.set(sign * 1.75, 0, 0);
        node.add(blade);
      }
      if (name === 'Seat') node.position.set(0, 0, 0.2);
      scull.add(node);
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

    const pose: Record<string, {
      x: number; y: number; z: number;
      rx: number; ry: number; rz: number;
      wx: number; wy: number; wz: number;
    }> = {};
    const sceneRoot = renderer.scene.instance as unknown as THREE.Scene;
    sceneRoot.updateMatrixWorld(true);
    const w = new THREE.Vector3();
    sceneRoot.traverse((object) => {
      if (!object.name) return;
      object.getWorldPosition(w);
      pose[object.name] = {
        x: object.position.x,
        y: object.position.y,
        z: object.position.z,
        rx: object.rotation.x,
        ry: object.rotation.y,
        rz: object.rotation.z,
        wx: w.x,
        wy: w.y,
        wz: w.z,
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
  //
  // The feather is a roll about the oar's own shaft (its local X axis, which
  // is the direction `build_crew.py` lays the loom down). Rotating about the
  // oar node's Z instead tilted the shaft out of horizontal and left the
  // blades swinging above the rower (#462), so this reads back the X-axis
  // rotation specifically.
  it('squares the blades on the drive and feathers them on the recovery', async () => {
    const scull = await mountAt(MID_DRIVE);

    const drive = await scull.at(MID_DRIVE);
    expect(drive.LeftOar.rx, 'the blade is squared mid-drive').toBeCloseTo(0, 5);
    expect(drive.LeftOar.rz, 'nothing rolls the shaft out of horizontal').toBeCloseTo(0, 5);

    const recovery = await scull.at(MID_RECOVERY);
    expect(recovery.LeftOar.rx).toBeCloseTo(FEATHER_RAD, 5);
    expect(recovery.LeftOar.rz, 'the shaft stays horizontal on the recovery (#462)').toBeCloseTo(0, 5);

    await scull.renderer.unmount();
  });

  // #462. The oars appeared to swing vertically above the rower rather than
  // sweeping horizontally fore-and-aft. Reading local rotation values alone
  // can miss this — the parent chain decides where each local axis lands in
  // world space — so this measures the blade's world position relative to
  // the gate and asserts the shaft stays in the horizontal plane.
  it('keeps the shaft horizontal in world space across the whole stroke (#462)', async () => {
    const scull = await mountAt(0);

    const samples = [0, 0.1, MID_DRIVE, STROKE_DRIVE_FRACTION - 0.001, MID_RECOVERY, 0.9];
    for (const phase of samples) {
      const nodes = await scull.at(phase);
      // The blade sub-node's world position is derived through the full
      // scull_root → scull → LeftOar → LeftOar_Blade chain. If the fix at
      // #462 regresses, the blade lifts off the horizontal plane here.
      const gateY = nodes.LeftOar.wy;
      const bladeY = nodes.LeftOar_Blade?.wy ?? gateY;
      const shaftRise = Math.abs(bladeY - gateY);
      expect(
        shaftRise,
        `shaft tipped out of horizontal at phase ${phase}: ΔY=${shaftRise}`,
      ).toBeLessThan(0.2);
    }

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

      // The wrapper nodes (`scull_root`, `scull`) are always present — the
      // real GLB carries them for the glTF Y-up transform. What matters is
      // that no rig node (`LeftOar`, `Seat`, `Rower_*`) appeared on a model
      // that was told it has none.
      const WRAPPERS = new Set(['scull_root', 'scull']);
      const rigAt = (p: typeof atCatch) =>
        Object.keys(p).filter((n) => !WRAPPERS.has(n));
      expect(rigAt(atCatch), 'the bare model grew nodes').toEqual([]);
      expect(rigAt(atFinish)).toEqual([]);

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
