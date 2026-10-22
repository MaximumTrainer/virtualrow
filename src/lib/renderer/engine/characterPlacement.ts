/**
 * Boat + ghost placement helpers (#570 FR1-FR3 / D6-a). Keeps the per-frame
 * curve read + model-matrix construction + stroke-phase derivation in one
 * testable spot so `attach.ts` stays about wiring and the unit tests can
 * exercise `holdBoat` / `finished` / `ghostDistanceAt` without a GPU.
 *
 * Stroke driver (D3-a): the stroke phase advances with cadence (strokes per
 * minute → cycles per second) scaled by `isPlaying`. The amplitude ridden
 * by the crew uniforms (`uStrokeAmp`) is `intensityFactor` clamped to [0, 1].
 */

import { vec3, type Vec3 } from '../math/vec3';
import { mat4, mat4FromRotationY, mat4Multiply } from '../math/mat4';
import type { Mat4 } from '../math/mat4';
import type { RouteCurve } from '../math/curve';
import type { RideFrame } from './rideFrame';
import { ghostDistanceAt, type GhostSource } from '../../../components/rower3d/ghost';

const BOAT_HEIGHT_Y = 0.05;

export interface PlacementState {
  modelMatrix: Mat4;
  world: Vec3;
  progress: number;
  distanceMeters: number;
  heading: number;
}

const makeTranslation = (out: Mat4, x: number, y: number, z: number): Mat4 => {
  out.fill(0);
  out[0] = 1;
  out[5] = 1;
  out[10] = 1;
  out[15] = 1;
  out[12] = x;
  out[13] = y;
  out[14] = z;
  return out;
};

export const createPlacement = (): PlacementState => ({
  modelMatrix: mat4(),
  world: vec3(),
  progress: 0,
  distanceMeters: 0,
  heading: 0,
});

/**
 * Boat placement: `holdBoat` pins progress to 0 (countdown), `finished`
 * pins it to 1. Otherwise `distanceMeters / totalLength`, clamped.
 */
export const placeBoat = (
  out: PlacementState,
  curve: RouteCurve | null,
  frame: RideFrame | null,
  totalLengthMeters: number,
  // Curve length is passed for future per-metre resampling (parked in #556);
  // included on the signature so callers that know it don't recompute.
  _curveLengthMetres: number,
  lateralOffsetX = 0,
): PlacementState => {
  if (!curve || !frame) {
    out.progress = 0;
    out.distanceMeters = 0;
    out.heading = 0;
    makeTranslation(out.modelMatrix, lateralOffsetX, BOAT_HEIGHT_Y, 0);
    out.world[0] = lateralOffsetX;
    out.world[1] = BOAT_HEIGHT_Y;
    out.world[2] = 0;
    return out;
  }
  const total = totalLengthMeters > 0 ? totalLengthMeters : 1;
  let progress = frame.distanceMeters / total;
  if (frame.holdBoat) progress = 0;
  else if (frame.finished) progress = 1;
  progress = Math.max(0, Math.min(1, progress));

  const point = curve.sample(progress);
  // Lateral offset in local-+X along the curve tangent (ghost sits to port).
  const tangentLen = Math.hypot(point.tangent[0], point.tangent[2]) || 1;
  const px = (-point.tangent[2] / tangentLen) * lateralOffsetX;
  const pz = (point.tangent[0] / tangentLen) * lateralOffsetX;

  const rot = mat4();
  mat4FromRotationY(rot, point.angle ?? 0);
  const trans = mat4();
  makeTranslation(trans, point.position[0] + px, point.position[1] + BOAT_HEIGHT_Y, point.position[2] + pz);
  mat4Multiply(out.modelMatrix, trans, rot);

  out.progress = progress;
  out.distanceMeters = Math.max(0, frame.distanceMeters);
  out.heading = point.angle ?? 0;
  out.world[0] = point.position[0] + px;
  out.world[1] = point.position[1] + BOAT_HEIGHT_Y;
  out.world[2] = point.position[2] + pz;
  return out;
};

/**
 * Ghost placement reads `ghostDistanceAt(ghost, elapsedSeconds)` for metres,
 * then re-uses `placeBoat` with the ghost's metres and a port lateral offset.
 * No ghost = no draw: callers check `metres === null`.
 */
export const placeGhost = (
  out: PlacementState,
  curve: RouteCurve | null,
  ghost: GhostSource | null,
  elapsedSeconds: number,
  totalLengthMeters: number,
  curveLengthMetres: number,
  lateralOffsetX: number,
): { metres: number } | null => {
  if (!ghost || !curve) return null;
  const metres = ghostDistanceAt(ghost, Math.max(0, elapsedSeconds));
  const synthetic: RideFrame = {
    paceSPer500: 0,
    distanceMeters: metres,
    cadence: 0,
    isPlaying: false,
    holdBoat: false,
    finished: false,
    intensityFactor: 0,
    elapsedSeconds,
    ghost: null,
  };
  placeBoat(out, curve, synthetic, totalLengthMeters, curveLengthMetres, lateralOffsetX);
  return { metres };
};

/**
 * Analytic sinusoidal stroke phase (D3-a). Cadence floor matches the three
 * scene's own `useFrame` floor of 18 spm (`boatComponents.tsx`).
 */
export const strokePhase = (
  cadence: number,
  elapsedSeconds: number,
  isPlaying: boolean,
): number => {
  if (!isPlaying) return 0;
  const spm = Math.max(18, cadence || 24);
  const freqHz = spm / 60;
  const phase = (elapsedSeconds * freqHz) % 1;
  return phase < 0 ? phase + 1 : phase;
};

/** Amplitude multiplier for the crew uniforms. 0 freezes; 1 is full stroke. */
export const strokeAmplitude = (frame: RideFrame | null): number => {
  if (!frame || !frame.isPlaying) return 0;
  const i = frame.intensityFactor;
  if (!Number.isFinite(i)) return 1;
  return Math.max(0, Math.min(1, i));
};
