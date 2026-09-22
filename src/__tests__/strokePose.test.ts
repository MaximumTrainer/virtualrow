import { describe, it, expect } from 'vitest';
import {
  BLADE_CLEARANCE_M,
  BLADE_DEPTH_M,
  BLADE_TRANSITION_FRACTION,
  CATCH_SWEEP_RAD,
  FEATHER_RAD,
  FINISH_SWEEP_RAD,
  SLIDE_TRAVEL_M,
  STROKE_DRIVE_FRACTION,
  strokePose,
} from '../components/rower3d/strokePose';

/**
 * One stroke model, used by both sculls.
 *
 * The procedural scull already animated the rower's arms from the stroke
 * phase; the GLB scull — which is what every real session renders — swept the
 * oars and left the rower rigid, so the boat appeared to row itself. Both read
 * from here now, so they cannot drift apart again (#273).
 */
describe('strokePose', () => {
  /**
   * The sweep was `sin(phase * 2pi) * 0.5` — an even 28.6 degrees either side
   * of square, with the oar square at the catch. A sculler's stroke is neither
   * of those things: the blade goes in at about 55 degrees towards the bow and
   * comes out at about 35 the other way (#329).
   */
  it('sweeps the oars from the catch angle to the finish angle', () => {
    expect(strokePose(0).oarSweep).toBeCloseTo(CATCH_SWEEP_RAD, 5);
    expect(strokePose(STROKE_DRIVE_FRACTION - 0.0001).oarSweep).toBeCloseTo(
      FINISH_SWEEP_RAD,
      3,
    );
  });

  it('sweeps back the other way through the recovery', () => {
    expect(strokePose(0.25).oarSweep).toBeGreaterThan(0);
    expect(strokePose(0.75).oarSweep).toBeLessThan(0);
    expect(strokePose(0.9999).oarSweep).toBeCloseTo(CATCH_SWEEP_RAD, 2);
  });

  it('reaches further towards the bow than past the rigger', () => {
    // A stroke is asymmetric, and this is the direction it is asymmetric in.
    expect(Math.abs(CATCH_SWEEP_RAD)).toBeGreaterThan(Math.abs(FINISH_SWEEP_RAD));
  });

  describe('the blades', () => {
    it('are squared and in the water through the drive', () => {
      const mid = strokePose(STROKE_DRIVE_FRACTION / 2);

      expect(mid.bladeFeatherRad, 'the blade is feathered during the drive').toBeCloseTo(
        0,
        6,
      );
      expect(mid.bladeHeightM, 'the blade is not in the water').toBeCloseTo(
        -BLADE_DEPTH_M,
        6,
      );
    });

    it('are feathered and clear of the water through the recovery', () => {
      const mid = strokePose(STROKE_DRIVE_FRACTION + (1 - STROKE_DRIVE_FRACTION) / 2);

      expect(mid.bladeFeatherRad).toBeCloseTo(FEATHER_RAD, 6);
      expect(mid.bladeHeightM, 'the blade drags through the recovery').toBeCloseTo(
        BLADE_CLEARANCE_M,
        6,
      );
    });

    // A blade that squares instantly is a blade that teleports. The
    // transition is the most recognisable thing a sculler does with their
    // hands, and it is the reason this is a ramp rather than a branch.
    it('take time to square and to feather', () => {
      const justAfterFinish = strokePose(
        STROKE_DRIVE_FRACTION + BLADE_TRANSITION_FRACTION / 2,
      );

      expect(Math.abs(justAfterFinish.bladeFeatherRad)).toBeGreaterThan(0);
      expect(Math.abs(justAfterFinish.bladeFeatherRad)).toBeLessThan(
        Math.abs(FEATHER_RAD),
      );
    });

    it('are squared again by the time they reach the catch', () => {
      // Within half a degree of square, and already under the surface: a blade
      // still feathering at the catch is a crab.
      const atCatch = strokePose(0.9999);
      expect(Math.abs((atCatch.bladeFeatherRad * 180) / Math.PI)).toBeLessThan(0.5);
      expect(atCatch.bladeHeightM).toBeLessThan(0);
    });

    it('never sit between the two heights for long', () => {
      // Most of a stroke has the blade either buried or clear; only the two
      // short transitions are in between.
      let between = 0;
      for (let i = 0; i < 1000; i += 1) {
        const { bladeHeightM } = strokePose(i / 1000);
        if (bladeHeightM > -BLADE_DEPTH_M + 0.01 && bladeHeightM < BLADE_CLEARANCE_M - 0.01) {
          between += 1;
        }
      }

      expect(between / 1000).toBeLessThan(BLADE_TRANSITION_FRACTION * 3);
    });
  });

  /**
   * Issue #330 — a drive is sequenced, not a shrug.
   *
   * `armPull`, `legCompression` and `bodyLean` all came off the same eased
   * `t`, so the legs, the back and the arms moved in lockstep. A real drive is
   * legs first, back through the middle, arms to finish; the recovery reverses
   * it — arms away, body over, then the slide.
   */
  describe('the sequence of the drive', () => {
    /** A phase a given fraction of the way through the drive. */
    const throughDrive = (fraction: number) => strokePose(STROKE_DRIVE_FRACTION * fraction);

    it('sends the legs down before the arms come in', () => {
      const early = throughDrive(0.2);

      expect(early.legCompression, 'the legs have not started').toBeLessThan(0.7);
      expect(early.armPull, 'the arms came in with the legs').toBeLessThan(0.05);
    });

    it('swings the back through the middle', () => {
      const early = throughDrive(0.15);
      const middle = throughDrive(0.5);

      expect(middle.bodyLean, 'the back never swung').toBeGreaterThan(early.bodyLean);
    });

    it('draws the arms in to finish', () => {
      expect(throughDrive(0.6).armPull, 'the arms have not begun').toBeGreaterThan(0.05);
      expect(throughDrive(0.999).armPull).toBeGreaterThan(0.9);
    });

    it('has everything at its end value by the finish', () => {
      const finish = throughDrive(0.999);

      expect(finish.legCompression).toBeLessThan(0.02);
      expect(finish.armPull).toBeGreaterThan(0.9);
      expect(finish.seatPosition).toBeGreaterThan(-0.02);
    });

    it('reverses the order on the recovery: arms away, body over, then slide', () => {
      const recovery = (fraction: number) =>
        strokePose(STROKE_DRIVE_FRACTION + (1 - STROKE_DRIVE_FRACTION) * fraction);

      // A fifth of the way back, the hands have gone and the slide has not.
      expect(recovery(0.2).armPull).toBeLessThan(0.6);
      expect(recovery(0.2).legCompression, 'the slide started before the hands left')
        .toBeLessThan(0.05);
      // Three quarters back, the slide is under way.
      expect(recovery(0.75).legCompression).toBeGreaterThan(0.2);
    });
  });

  describe('the slide', () => {
    it('follows the legs exactly, so the seat and the knees agree', () => {
      for (let i = 0; i < 200; i += 1) {
        const pose = strokePose(i / 200);
        expect(pose.seatPosition).toBeCloseTo(-SLIDE_TRAVEL_M * pose.legCompression, 6);
      }
    });

    it('travels the length of the slide over a stroke', () => {
      let lowest = Infinity;
      let highest = -Infinity;
      for (let i = 0; i < 400; i += 1) {
        const { seatPosition } = strokePose(i / 400);
        lowest = Math.min(lowest, seatPosition);
        highest = Math.max(highest, seatPosition);
      }

      expect(highest - lowest, 'the seat barely moves').toBeGreaterThan(0.4);
    });
  });

  // Nothing may jump at the seam, or the rower twitches once a stroke.
  it('is continuous across the end of the stroke', () => {
    const before = strokePose(0.9999);
    const after = strokePose(0);

    for (const key of ['legCompression', 'armPull', 'bodyLean', 'seatPosition'] as const) {
      expect(Math.abs(before[key] - after[key]), `${key} jumps at the catch`).toBeLessThan(
        0.05,
      );
    }
  });

  it('draws the arms in through the drive and extends them on the recovery', () => {
    // The drive is the first part of the cycle: legs down, body back, arms in.
    const early = strokePose(0.05);
    const endOfDrive = strokePose(STROKE_DRIVE_FRACTION);
    const recovery = strokePose(0.9);

    expect(endOfDrive.armPull).toBeGreaterThan(early.armPull);
    expect(recovery.armPull).toBeLessThan(endOfDrive.armPull);
  });

  it('moves the arms whenever the oars move', () => {
    // The fault this exists to prevent: oars sweeping while the rower holds
    // still. Sampling the cycle, neither may be frozen while the other moves.
    const samples = Array.from({ length: 24 }, (_, i) => strokePose(i / 24));
    const oarRange = Math.max(...samples.map((s) => s.oarSweep)) - Math.min(...samples.map((s) => s.oarSweep));
    const armRange = Math.max(...samples.map((s) => s.upperArmAngle)) - Math.min(...samples.map((s) => s.upperArmAngle));

    expect(oarRange).toBeGreaterThan(0.5);
    expect(armRange).toBeGreaterThan(0.5);
  });

  it('keeps the forearm and upper arm moving together', () => {
    // An elbow that straightens while the shoulder draws in reads as broken.
    const a = strokePose(0.1);
    const b = strokePose(0.3);

    expect(Math.sign(b.upperArmAngle - a.upperArmAngle)).toBe(
      Math.sign(b.forearmAngle - a.forearmAngle),
    );
  });

  it('is continuous across the wrap from one stroke to the next', () => {
    const endOfCycle = strokePose(0.999);
    const startOfNext = strokePose(0);

    expect(Math.abs(endOfCycle.oarSweep - startOfNext.oarSweep)).toBeLessThan(0.05);
    expect(Math.abs(endOfCycle.armPull - startOfNext.armPull)).toBeLessThan(0.05);
  });

  it('handles a phase outside 0..1 rather than producing nonsense', () => {
    for (const phase of [-0.5, 1.5, 2.25, Number.NaN]) {
      const pose = strokePose(phase);
      expect(Number.isFinite(pose.oarSweep)).toBe(true);
      expect(Number.isFinite(pose.upperArmAngle)).toBe(true);
      expect(Number.isFinite(pose.armPull)).toBe(true);
    }
  });
});
