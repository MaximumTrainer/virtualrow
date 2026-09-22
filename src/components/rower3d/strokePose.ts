// ============================================================================
// ONE STROKE, SHARED BY BOTH SCULLS
//
// The procedural scull animated the rower properly — legs, body, arms, all
// driven off the stroke phase. The GLB scull, which is what every real session
// renders, swept the oars and left the rower rigid: the blades swung while the
// arms held still, so the boat appeared to row itself (#273).
//
// The stroke lives here now and both read from it, so the oars and the body
// cannot drift apart again. The numbers are the ones the procedural scull was
// already using; nothing about how it looks has changed.
// ============================================================================

/**
 * Share of the cycle spent on the drive.
 *
 * A real stroke is roughly a third drive to two thirds recovery. The value
 * kept here is the one the procedural rower already used.
 */
export const STROKE_DRIVE_FRACTION = 0.4;

/** Oar angle at the catch, in radians. Negative is towards the bow. */
export const CATCH_SWEEP_RAD = (-55 * Math.PI) / 180;
/** Oar angle at the finish, in radians. */
export const FINISH_SWEEP_RAD = (35 * Math.PI) / 180;

/** Blade rotation about the shaft on the recovery, in radians. */
export const FEATHER_RAD = (-85 * Math.PI) / 180;

/** How far the blade tip sits below the surface through the drive, in metres. */
export const BLADE_DEPTH_M = 0.15;
/** How far it clears the surface on the recovery, in metres. */
export const BLADE_CLEARANCE_M = 0.25;

/**
 * How much of the stroke the blade takes to square up or feather.
 *
 * The issue asks for 40 ms. Expressed as a fraction of the stroke rather than
 * in seconds because that is what a phase can carry: at 30 strokes a minute a
 * stroke is two seconds, so 40 ms is 2% of it.
 */
export const BLADE_TRANSITION_FRACTION = 0.02;

/**
 * How far the gate end of the oar moves for a metre of blade movement.
 *
 * The oar pivots at the gate, so raising the shaft there raises the tip by a
 * multiple of it. The inboard is roughly a third of the outboard on a sculling
 * blade, which is where this comes from.
 */
export const OAR_LEVER_RATIO = 0.35;

export interface StrokePose {
  /** Oar rotation about its gate, radians. Positive sweeps one way. */
  oarSweep: number;
  /**
   * Blade rotation about the shaft, radians.
   *
   * Zero is squared — the face vertical and in the water. `FEATHER_RAD` is
   * flat, which is where it sits on the recovery so it does not catch the wind
   * or the water on the way forward.
   */
  bladeFeatherRad: number;
  /**
   * Blade tip height relative to the water surface, in metres.
   *
   * Negative is in the water. Nothing in the scene had the blades touch the
   * water at all before #329: they swept over it at a constant height.
   */
  bladeHeightM: number;
  /** 0 at the catch, 1 at the finish. Drives the arms and body. */
  armPull: number;
  legCompression: number;
  bodyLean: number;
  seatPosition: number;
  upperArmAngle: number;
  forearmAngle: number;
  thighAngle: number;
  shinAngle: number;
}

const easeInOut = (t: number): number =>
  t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;

/**
 * How far through feathering the blade is: 0 squared, 1 flat.
 *
 * Ramped over `BLADE_TRANSITION_FRACTION` at each end rather than switched,
 * because a blade that squares instantly is a blade that teleports — the
 * transition is the most recognisable thing a sculler does with their hands.
 */
const bladeSquareness = (phase: number): number => {
  const ramp = BLADE_TRANSITION_FRACTION;
  // Feathering, just after the finish.
  if (phase >= STROKE_DRIVE_FRACTION && phase < STROKE_DRIVE_FRACTION + ramp) {
    return (phase - STROKE_DRIVE_FRACTION) / ramp;
  }
  // Squaring, just before the catch.
  if (phase >= 1 - ramp) return (1 - phase) / ramp;
  return phase < STROKE_DRIVE_FRACTION ? 0 : 1;
};

/**
 * Where every moving part of the rower is, at this point in the stroke.
 *
 * `phase` is 0..1 through one stroke and is wrapped rather than clamped, so a
 * caller accumulating phase across strokes gets a continuous cycle instead of
 * sticking at the finish.
 */
export const strokePose = (phase: number): StrokePose => {
  const safe = Number.isFinite(phase) ? ((phase % 1) + 1) % 1 : 0;

  let legCompression: number;
  let armPull: number;
  let bodyLean: number;
  let seatPosition: number;

  if (safe < STROKE_DRIVE_FRACTION) {
    const t = easeInOut(safe / STROKE_DRIVE_FRACTION);
    legCompression = 1 - t;
    armPull = t;
    bodyLean = -0.3 + t * 0.5;
    seatPosition = -0.5 + t * 0.5;
  } else {
    const t = easeInOut((safe - STROKE_DRIVE_FRACTION) / (1 - STROKE_DRIVE_FRACTION));
    legCompression = t;
    armPull = 1 - t;
    bodyLean = 0.2 - t * 0.5;
    seatPosition = t * -0.5;
  }

  // Asymmetric, because a stroke is. The old `sin(phase * 2pi) * 0.5` swept an
  // even 28.6 degrees either side of square, which is neither the angle a
  // sculler reaches at the catch nor the one they finish at.
  const sweep = safe < STROKE_DRIVE_FRACTION
    ? CATCH_SWEEP_RAD +
      (FINISH_SWEEP_RAD - CATCH_SWEEP_RAD) * easeInOut(safe / STROKE_DRIVE_FRACTION)
    : FINISH_SWEEP_RAD +
      (CATCH_SWEEP_RAD - FINISH_SWEEP_RAD) *
        easeInOut((safe - STROKE_DRIVE_FRACTION) / (1 - STROKE_DRIVE_FRACTION));

  return {
    oarSweep: sweep,
    bladeFeatherRad: bladeSquareness(safe) * FEATHER_RAD,
    bladeHeightM:
      -BLADE_DEPTH_M +
      (BLADE_DEPTH_M + BLADE_CLEARANCE_M) * bladeSquareness(safe),
    armPull,
    legCompression,
    bodyLean,
    seatPosition,
    upperArmAngle: -0.5 + armPull * 1.2,
    forearmAngle: 0.3 + armPull * 0.8,
    thighAngle: -0.3 + legCompression * 1.0,
    shinAngle: 0.2 + legCompression * 1.2,
  };
};
