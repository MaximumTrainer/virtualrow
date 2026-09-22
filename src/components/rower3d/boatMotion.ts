import * as THREE from 'three';
import { STROKE_DRIVE_FRACTION } from './strokePose';

// ============================================================================
// WHAT THE BOAT DOES DURING A STROKE (#329)
//
// `usePhysicsEngine.dispatchTick` low-passes `500 / pace` into a constant
// speed, so the boat glides down the route at a fixed velocity with no rhythm
// at all. On water a scull surges through the drive and checks at the catch,
// the bow drops as the legs go down and lifts at the finish, and the hull
// heaves with it. None of that was here.
//
// ## Why the surge integrates to zero
//
// The erg's distance is the source of truth, and it has to stay that way: a
// rower who pulls 2,000 m on the handle has rowed 2,000 m, whatever the
// picture does. So the surge is a *visual* multiplier whose mean over one
// stroke is one — it redistributes the same distance within the stroke rather
// than adding any. `boatMotionTest` holds that to within 2%, and it is the
// property most worth protecting here: a surge that leaked into the distance
// would be a rowing app that lies about how far you went.
// ============================================================================

export interface BoatMotion {
  /** Velocity multiplier offset: +1 at the peak of the drive, negative at the catch. */
  surge: number;
  /** Hull pitch in radians. Negative drops the bow. */
  pitchRad: number;
  /** Hull rise and fall in metres. */
  heaveM: number;
}

/** How much of the mean speed the surge adds at its peak. */
export const SURGE_AMPLITUDE = 0.28;

/** Bow-down pitch at the catch, in degrees. */
export const CATCH_PITCH_DEGREES = -0.8;
/** Bow-up pitch at the finish, in degrees. */
export const FINISH_PITCH_DEGREES = 1.2;

/**
 * How far the hull lifts per radian of pitch, in metres.
 *
 * The two are in phase because they come from the same thing: the crew's
 * weight moving along the boat.
 */
const HEAVE_PER_RADIAN = 0.9;

/**
 * Where the boat is in its stroke, at a phase from 0 (catch) to 1.
 *
 * `surge` is shaped so the drive's positive half and the recovery's negative
 * half cancel. The recovery's decay term is what makes them cancel rather than
 * merely look plausible; the test integrates it rather than trusting the shape.
 */
export const boatMotion = (phase: number): BoatMotion => {
  const safe = Number.isFinite(phase) ? ((phase % 1) + 1) % 1 : 0;
  const drive = safe < STROKE_DRIVE_FRACTION;
  const t = drive
    ? safe / STROKE_DRIVE_FRACTION
    : (safe - STROKE_DRIVE_FRACTION) / (1 - STROKE_DRIVE_FRACTION);

  const surge = drive
    ? Math.sin(t * Math.PI)
    : -RECOVERY_SURGE_SCALE * Math.sin(t * Math.PI);

  const pitchDegrees = drive
    ? CATCH_PITCH_DEGREES + (FINISH_PITCH_DEGREES - CATCH_PITCH_DEGREES) * t
    : FINISH_PITCH_DEGREES + (CATCH_PITCH_DEGREES - FINISH_PITCH_DEGREES) * t;
  const pitchRad = THREE.MathUtils.degToRad(pitchDegrees);

  return { surge, pitchRad, heaveM: -pitchRad * HEAVE_PER_RADIAN };
};

/**
 * How deep the recovery's negative surge has to be for the stroke to cancel.
 *
 * Both halves are half-sines, so each integrates to 2/π of its own duration
 * times its amplitude. The drive lasts `STROKE_DRIVE_FRACTION` of the stroke
 * and the recovery the rest, so the recovery's amplitude has to be the ratio
 * of the two for the areas to match.
 *
 * The issue proposes a fixed −0.6 with a decay term. At the 0.4 drive fraction
 * this project uses, that leaves a residue: the areas come out 0.4 against
 * 0.27, so the boat gains about a third of a stroke's worth of distance every
 * stroke. Derived rather than chosen, it cancels at any drive fraction — which
 * matters, because #330 is about to make the drive fraction a variable.
 */
const RECOVERY_SURGE_SCALE = STROKE_DRIVE_FRACTION / (1 - STROKE_DRIVE_FRACTION);

/** The displayed speed for a mean speed and a point in the stroke. */
export const surgedSpeed = (meanSpeedMps: number, phase: number): number =>
  meanSpeedMps * (1 + SURGE_AMPLITUDE * boatMotion(phase).surge);
