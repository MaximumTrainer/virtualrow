/**
 * Three-free port of `src/components/rower3d/cameraRig.ts` (#550 FR5).
 *
 * The three version damps the camera's *offset* from the boat and reads the
 * boat's own motion exactly; keep the same shape here, with `vec3Damp` as
 * the frame-rate-independent exponential follower.
 */

import { vec3Damp, vec3Set, type Vec3 } from '../math/vec3';
import { vec3 } from '../math/vec3';

export type CameraView = 'chase' | 'side' | 'bow' | 'high';

export const CAMERA_VIEWS: readonly CameraView[] = ['chase', 'side', 'bow', 'high'];

const BOW_METRES = 4.4;

interface ViewOffset {
  back: number;
  up: number;
  side: number;
  ahead: number;
}

const OFFSETS: Record<CameraView, ViewOffset> = {
  chase: { back: 7, up: 2.6, side: 0, ahead: 0 },
  side: { back: 0, up: 3, side: 12, ahead: 0 },
  bow: { back: -(BOW_METRES + 0.8), up: 1.1, side: 0, ahead: 30 },
  high: { back: 18, up: 9, side: 0, ahead: 0 },
};

export const BASE_FOV = 58;
export const FOV_SPEED_RANGE = 10;
export const FOV_FULL_SPEED = 5;
export const POSITION_TAU = 0.35;
export const LOOK_AT_TAU = 0.2;

export interface RigInput {
  boat: Vec3;
  tangent: Vec3;
  velocityMps: number;
  view: CameraView;
  bendSign: number;
  reducedMotion?: boolean;
}

export interface RigTarget {
  position: Vec3;
  lookAt: Vec3;
  fov: number;
}

export const createRigTarget = (): RigTarget => ({
  position: vec3(),
  lookAt: vec3(),
  fov: BASE_FOV,
});

const clamp = (v: number, lo: number, hi: number): number =>
  v < lo ? lo : v > hi ? hi : v;

export const cameraTarget = (
  { boat, tangent, velocityMps, view, bendSign, reducedMotion = false }: RigInput,
  out: RigTarget,
): RigTarget => {
  const offset = OFFSETS[view] ?? OFFSETS.chase;
  const perpX = -tangent[2];
  const perpZ = tangent[0];
  const side = offset.side * (bendSign === 0 ? 1 : Math.sign(bendSign));

  vec3Set(
    out.position,
    boat[0] - tangent[0] * offset.back + perpX * side,
    boat[1] + offset.up,
    boat[2] - tangent[2] * offset.back + perpZ * side,
  );
  vec3Set(
    out.lookAt,
    boat[0] + tangent[0] * offset.ahead,
    boat[1] + 0.3,
    boat[2] + tangent[2] * offset.ahead,
  );
  out.fov = reducedMotion
    ? BASE_FOV
    : BASE_FOV + FOV_SPEED_RANGE * clamp(velocityMps / FOV_FULL_SPEED, 0, 1);

  return out;
};

export const portraitFov = (baseFov: number, aspect: number): number => {
  if (!Number.isFinite(aspect) || aspect <= 0 || aspect >= 1) return baseFov;
  return Math.min(100, baseFov + (1 - aspect) * 35);
};

export const nextView = (view: CameraView): CameraView => {
  const index = CAMERA_VIEWS.indexOf(view);
  return CAMERA_VIEWS[(index + 1) % CAMERA_VIEWS.length] ?? CAMERA_VIEWS[0];
};

export const isCameraView = (value: unknown): value is CameraView =>
  typeof value === 'string' && (CAMERA_VIEWS as readonly string[]).includes(value);

/**
 * Move `offset` towards the current target offset, then write the world
 * camera position back into `out`. See the three version for why the offset
 * (not the world position) is what gets damped.
 */
export const dampedFollowOffset = (
  offset: Vec3,
  targetOffset: Vec3,
  boat: Vec3,
  tau: number,
  dt: number,
  out: Vec3,
): Vec3 => {
  vec3Damp(offset, offset, targetOffset, tau, dt);
  out[0] = boat[0] + offset[0];
  out[1] = boat[1] + offset[1];
  out[2] = boat[2] + offset[2];
  return out;
};
