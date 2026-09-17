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

export interface StrokePose {
  /** Oar rotation about its gate, radians. Positive sweeps one way. */
  oarSweep: number;
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

  return {
    oarSweep: Math.sin(safe * Math.PI * 2) * 0.5,
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
