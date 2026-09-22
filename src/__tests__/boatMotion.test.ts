import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  CATCH_PITCH_DEGREES,
  FINISH_PITCH_DEGREES,
  SURGE_AMPLITUDE,
  boatMotion,
  surgedSpeed,
} from '../components/rower3d/boatMotion';
import { STROKE_DRIVE_FRACTION } from '../components/rower3d/strokePose';

/**
 * Issue #329 — the boat had no stroke.
 *
 * `dispatchTick` low-passes `500 / pace` into a constant speed, so the hull
 * glided down the route at a fixed velocity: no surge on the drive, no check
 * at the catch, no pitch, no heave. On water a scull does all four, and it is
 * the largest single gap in how the thing feels.
 */

const SAMPLES = 2000;

/** The mean of `surge` over one whole stroke, sampled evenly. */
const meanSurge = () => {
  let total = 0;
  for (let i = 0; i < SAMPLES; i += 1) total += boatMotion(i / SAMPLES).surge;
  return total / SAMPLES;
};

describe('the surge', () => {
  it('pushes the boat through the drive', () => {
    expect(boatMotion(STROKE_DRIVE_FRACTION / 2).surge).toBeGreaterThan(0.9);
  });

  it('checks the boat at the catch and through the recovery', () => {
    expect(boatMotion(STROKE_DRIVE_FRACTION + (1 - STROKE_DRIVE_FRACTION) / 2).surge)
      .toBeLessThan(0);
  });

  /**
   * The property this module exists to protect.
   *
   * The erg's distance is the source of truth: a rower who pulls 2,000 m on
   * the handle has rowed 2,000 m whatever the picture does. The surge
   * redistributes distance within a stroke and must not add any.
   */
  it('adds no distance over a whole stroke', () => {
    expect(Math.abs(meanSurge()), 'the surge is leaking into the distance').toBeLessThan(
      0.02,
    );
  });

  // The issue proposes a fixed −0.6 for the recovery. At this project's 0.4
  // drive fraction the two half-sines then have areas of 0.4 and 0.27, so the
  // boat gains about a third of a stroke's distance every stroke. Deriving the
  // scale from the drive fraction cancels at any split — which matters,
  // because #330 is about to make the split a variable.
  it('would still add no distance if the drive were a different length', () => {
    // Sampled through the module rather than recomputed, so this fails if the
    // derivation is ever replaced by a hard-coded number.
    const drive = boatMotion(STROKE_DRIVE_FRACTION / 2).surge;
    const recovery = boatMotion(STROKE_DRIVE_FRACTION + (1 - STROKE_DRIVE_FRACTION) / 2)
      .surge;

    expect(drive * STROKE_DRIVE_FRACTION).toBeCloseTo(
      -recovery * (1 - STROKE_DRIVE_FRACTION),
      6,
    );
  });

  it('is continuous across the stroke boundary', () => {
    // A step here would be a visible jolt once a stroke.
    expect(boatMotion(0).surge).toBeCloseTo(boatMotion(0.9999).surge, 2);
    expect(Math.abs(boatMotion(STROKE_DRIVE_FRACTION - 0.0001).surge)).toBeLessThan(0.02);
    expect(Math.abs(boatMotion(STROKE_DRIVE_FRACTION + 0.0001).surge)).toBeLessThan(0.02);
  });

  it('reads a phase outside 0-1 as the same point in the stroke', () => {
    expect(boatMotion(1.25).surge).toBeCloseTo(boatMotion(0.25).surge, 10);
    expect(boatMotion(-0.75).surge).toBeCloseTo(boatMotion(0.25).surge, 10);
  });

  it('treats a phase that is not a number as the catch', () => {
    expect(boatMotion(Number.NaN)).toEqual(boatMotion(0));
  });
});

describe('the pitch and heave', () => {
  it('drops the bow at the catch and lifts it at the finish', () => {
    expect(boatMotion(0).pitchRad).toBeCloseTo(
      THREE.MathUtils.degToRad(CATCH_PITCH_DEGREES),
      6,
    );
    expect(boatMotion(STROKE_DRIVE_FRACTION - 0.0001).pitchRad).toBeCloseTo(
      THREE.MathUtils.degToRad(FINISH_PITCH_DEGREES),
      3,
    );
  });

  it('never pitches further than the bounds the issue set', () => {
    for (let i = 0; i < SAMPLES; i += 1) {
      const degrees = THREE.MathUtils.radToDeg(boatMotion(i / SAMPLES).pitchRad);
      expect(degrees).toBeGreaterThanOrEqual(CATCH_PITCH_DEGREES - 0.001);
      expect(degrees).toBeLessThanOrEqual(FINISH_PITCH_DEGREES + 0.001);
    }
  });

  it('heaves in phase with the pitch, and within a couple of centimetres', () => {
    for (let i = 0; i < SAMPLES; i += 1) {
      const { pitchRad, heaveM } = boatMotion(i / SAMPLES);
      // `Math.sign(-0)` is -0, which is not `+0` to `Object.is` — compare the
      // product instead, which says the same thing without the signed zero.
      expect(pitchRad * heaveM).toBeLessThanOrEqual(0);
      expect(Math.abs(heaveM)).toBeLessThanOrEqual(0.025);
    }
  });
});

describe('surgedSpeed', () => {
  it('speeds the boat up through the drive and slows it on the recovery', () => {
    const mean = 4.17;
    expect(surgedSpeed(mean, STROKE_DRIVE_FRACTION / 2)).toBeGreaterThan(mean);
    expect(
      surgedSpeed(mean, STROKE_DRIVE_FRACTION + (1 - STROKE_DRIVE_FRACTION) / 2),
    ).toBeLessThan(mean);
  });

  it('never sends the boat backwards, however hard the check', () => {
    for (let i = 0; i < SAMPLES; i += 1) {
      expect(surgedSpeed(4.17, i / SAMPLES)).toBeGreaterThan(0);
    }
  });

  it('leaves a stationary boat stationary', () => {
    expect(surgedSpeed(0, STROKE_DRIVE_FRACTION / 2)).toBe(0);
  });

  it('averages out to the speed it was given', () => {
    let total = 0;
    for (let i = 0; i < SAMPLES; i += 1) total += surgedSpeed(4.17, i / SAMPLES);
    expect(total / SAMPLES).toBeCloseTo(4.17, 2);
  });

  it('surges by the amplitude the issue asked for', () => {
    expect(SURGE_AMPLITUDE).toBeCloseTo(0.28, 5);
  });
});
