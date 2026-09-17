import { describe, it, expect } from 'vitest';
import { strokePose, STROKE_DRIVE_FRACTION } from '../components/rower3d/strokePose';

/**
 * One stroke model, used by both sculls.
 *
 * The procedural scull already animated the rower's arms from the stroke
 * phase; the GLB scull — which is what every real session renders — swept the
 * oars and left the rower rigid, so the boat appeared to row itself. Both read
 * from here now, so they cannot drift apart again (#273).
 */
describe('strokePose', () => {
  it('sweeps the oars through a full cycle', () => {
    const catchPose = strokePose(0);
    const quarter = strokePose(0.25);
    const threeQuarter = strokePose(0.75);

    expect(catchPose.oarSweep).toBeCloseTo(0, 5);
    expect(quarter.oarSweep).toBeGreaterThan(0);
    expect(threeQuarter.oarSweep).toBeLessThan(0);
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
