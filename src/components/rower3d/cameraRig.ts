import * as THREE from 'three';

// ============================================================================
// THE CAMERA RIG (#328)
//
// `RowerScene` hard-set the camera every frame: boat − tangent × 6, two and a
// half metres up, `lookAt(boat + 0.3)`. No lag and no damping, so every wobble
// in the tangent reached the camera — and the tangent is sampled from dense
// Hermite points, which wobble on bends by construction (#224). A fixed 60°
// field of view on top of that, so a boat at racing pace looked exactly like a
// boat at rest.
//
// Pure: the rig decides where the camera *wants* to be, and the frame loop
// moves it there. That split is what makes the framing testable at all — the
// old version could only be checked by looking at it.
// ============================================================================

export type CameraView = 'chase' | 'side' | 'bow' | 'high';

/** The order `V` cycles through. Chase first: it is what a rower expects. */
export const CAMERA_VIEWS: readonly CameraView[] = ['chase', 'side', 'bow', 'high'];

/** Where the hull ends, forward of the boat's origin, in metres. */
const BOW_METRES = 4.4;

interface ViewOffset {
  /** Metres behind the boat along the tangent. Negative is ahead of it. */
  back: number;
  /** Metres above the boat. */
  up: number;
  /** Metres to the side, positive towards the outside of the bend. */
  side: number;
  /** Metres ahead of the boat that the camera looks at. */
  ahead: number;
}

const OFFSETS: Record<CameraView, ViewOffset> = {
  chase: { back: 7, up: 2.6, side: 0, ahead: 0 },
  side: { back: 0, up: 3, side: 12, ahead: 0 },
  // The issue's code sample puts this 0.8 m ahead of the boat's *origin*,
  // which is the middle of an eight-metre hull — the camera would sit inside
  // the boat. FR1 says 0.8 m ahead of the bow, and that is what this is.
  bow: { back: -(BOW_METRES + 0.8), up: 1.1, side: 0, ahead: 30 },
  high: { back: 18, up: 9, side: 0, ahead: 0 },
};

/** Field of view at rest, in degrees. */
export const BASE_FOV = 58;
/** How much the field of view opens at speed, in degrees. */
export const FOV_SPEED_RANGE = 10;
/** The speed, in m/s, at which the field of view is fully open. */
export const FOV_FULL_SPEED = 5;

export interface RigInput {
  boat: THREE.Vector3;
  /** Unit vector along the direction of travel. */
  tangent: THREE.Vector3;
  velocityMps: number;
  view: CameraView;
  /** Which way the route is turning: +1, −1, or 0 on a straight. */
  bendSign: number;
  /**
   * Whether the viewer has asked for reduced motion.
   *
   * The field of view coupling is motion the viewer did not ask for and
   * cannot stop, which is the kind the setting exists for. Off, the camera
   * holds `BASE_FOV` however fast the boat is going.
   */
  reducedMotion?: boolean;
}

export interface RigTarget {
  position: THREE.Vector3;
  lookAt: THREE.Vector3;
  fov: number;
}

/** A target the frame loop can reuse, so the rig allocates nothing per frame. */
export const createRigTarget = (): RigTarget => ({
  position: new THREE.Vector3(),
  lookAt: new THREE.Vector3(),
  fov: BASE_FOV,
});

/**
 * Where the camera wants to be, written into `out`.
 *
 * In-place because this runs every frame: three `Vector3`s a frame is the kind
 * of garbage that shows up as a stutter rather than as a slowdown.
 */
export const cameraTarget = (
  { boat, tangent, velocityMps, view, bendSign, reducedMotion = false }: RigInput,
  out: RigTarget,
): RigTarget => {
  const offset = OFFSETS[view] ?? OFFSETS.chase;

  // Perpendicular to the tangent, in the horizontal plane. A camera that
  // banked with the route would make a rower seasick, so this stays flat.
  const perpX = -tangent.z;
  const perpZ = tangent.x;
  // A straight has no outside, so the side view picks one and keeps it rather
  // than swapping banks every time the curvature crosses zero.
  const side = offset.side * (bendSign === 0 ? 1 : Math.sign(bendSign));

  out.position.set(
    boat.x - tangent.x * offset.back + perpX * side,
    boat.y + offset.up,
    boat.z - tangent.z * offset.back + perpZ * side,
  );
  out.lookAt.set(
    boat.x + tangent.x * offset.ahead,
    boat.y + 0.3,
    boat.z + tangent.z * offset.ahead,
  );
  out.fov = reducedMotion
    ? BASE_FOV
    : BASE_FOV +
      FOV_SPEED_RANGE * THREE.MathUtils.clamp(velocityMps / FOV_FULL_SPEED, 0, 1);

  return out;
};

/**
 * Move `current` towards `target`, frame-rate independently.
 *
 * `lerp(t, 0.1)` per frame is the usual shortcut and it is wrong: it converges
 * twice as fast at 120 fps as at 60, so the camera feels different on
 * different machines. The exponential form converges at the same rate in
 * *seconds* whatever the frame rate, which is the only version anyone can tune.
 */
export const damp = (
  current: THREE.Vector3,
  target: THREE.Vector3,
  tau: number,
  dt: number,
): THREE.Vector3 => {
  if (tau <= 0) return current.copy(target);
  return current.lerp(target, 1 - Math.exp(-dt / tau));
};

/**
 * Damp the camera's *offset* from the boat, and place it accordingly.
 *
 * Damping the world position directly is the obvious thing and it is subtly
 * wrong: an exponential follower trails a moving target by velocity times the
 * time constant, in steady state. At racing pace and a 0.35 s constant that is
 * a metre and a half, so the chase camera measured 8.04 m back from a boat it
 * is supposed to sit 7 m behind - and the faster the rower went, the further
 * away the boat got.
 *
 * The wobble the damping exists to absorb is in the *offset* - the tangent
 * swinging about on a bend - not in the boat's travel down the route. So the
 * offset is what is damped, and the boat's own motion is followed exactly.
 *
 * `offset` is the follower's state and is mutated; `out` receives the world
 * position.
 */
export const dampedFollow = (
  offset: THREE.Vector3,
  targetPosition: THREE.Vector3,
  boat: THREE.Vector3,
  tau: number,
  dt: number,
  out: THREE.Vector3,
  scratch: THREE.Vector3,
): THREE.Vector3 => {
  scratch.subVectors(targetPosition, boat);
  damp(offset, scratch, tau, dt);
  return out.addVectors(boat, offset);
};

/** Seconds for the camera's position to close most of the gap. */
export const POSITION_TAU = 0.35;
/**
 * Seconds for the look-at point to close most of the gap.
 *
 * Shorter than the position: a camera that arrives before it has finished
 * turning reads as a swing, and the other way round reads as a drift.
 */
export const LOOK_AT_TAU = 0.2;

/** The next view in the cycle. Unknown input starts the cycle over. */
export const nextView = (view: CameraView): CameraView => {
  const index = CAMERA_VIEWS.indexOf(view);
  return CAMERA_VIEWS[(index + 1) % CAMERA_VIEWS.length] ?? CAMERA_VIEWS[0];
};

/** Whether a stored value names a view this build knows. */
export const isCameraView = (value: unknown): value is CameraView =>
  typeof value === 'string' && (CAMERA_VIEWS as readonly string[]).includes(value);

/**
 * Widen the vertical field of view on a portrait or narrow canvas.
 *
 * three's `fov` is vertical, so a tall narrow viewport crops horizontally and
 * a portrait phone loses the banks either side of the lane (#195). Scaling by
 * aspect restores roughly the same horizontal coverage.
 *
 * This used to live in `CameraAspectFix`, which wrote `camera.fov` from a
 * resize effect. That worked while nothing else touched the field of view;
 * the rig writes it every frame, so the two would have fought and the rig
 * would have won on the very next frame. Composed here instead: the rig's
 * speed coupling decides the base, and this widens it.
 */
export const portraitFov = (baseFov: number, aspect: number): number => {
  if (!Number.isFinite(aspect) || aspect <= 0 || aspect >= 1) return baseFov;
  return Math.min(100, baseFov + (1 - aspect) * 35);
};
