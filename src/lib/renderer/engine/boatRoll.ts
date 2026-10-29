/**
 * Boat lean / heel into turns (#571). The route curve's heading is sampled
 * twice a short arc-length apart; the change per metre (curvature) feeds a
 * smooth clamped roll angle. Pure helpers so the test suite can exercise
 * the maths without a GPU.
 *
 * **Why this exists at all.** The pre-#571 boat sits flat (no roll); a real
 * shell heels INTO a turn as the crew counters the centripetal force on the
 * stroke side. Even a few degrees reads clearly from the chase camera and
 * sells the river bend as "we're turning" rather than "the scenery slid".
 *
 * **Convention.** The route tangent sets a heading `angle = atan2(x, z)`
 * (see `curve.ts`), so a +Z-pointing tangent is `0`. The boat matrix today
 * is `trans * rot_Y(angle)`, which rotates the boat's local-forward +Z onto
 * the tangent. Rolling the boat into the turn is therefore a rotation
 * around the boat's local +Z axis, applied AFTER `rot_Y` on the right-hand
 * side: `trans * rot_Y * rot_Z(roll)`. See `placeBoat` in
 * `characterPlacement.ts` where this gets wired in.
 *
 * **Sign convention.** `curvature > 0` means the heading is turning counter-
 * clockwise (left) as we move along the route; the boat should lean LEFT
 * (negative roll about +Z in a right-handed frame where +Y is up and the
 * boat's forward is +Z — rotating the right-hand gives roll+ = starboard
 * tipping toward +Y, so leaning left = negative roll). `boatRollRadians`
 * therefore flips the sign so a left turn produces a negative roll.
 */

import type { RouteCurve } from '../math/curve';
import { vec3, type Vec3 } from '../math/vec3';

/** Shortest signed angular difference `b - a`, mapped into (-π, π]. */
export const angleDiff = (a: number, b: number): number => {
  let d = (b - a) % (2 * Math.PI);
  if (d > Math.PI) d -= 2 * Math.PI;
  if (d <= -Math.PI) d += 2 * Math.PI;
  return d;
};

/** Hard clamp used for the roll magnitude. */
const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

/**
 * Route curvature at `progress`, in radians per metre (`dθ/ds`). Positive
 * = turning counter-clockwise. `lookAheadMetres` is the half-window used
 * for the central difference — a few metres smooths out the rownative
 * polyline noise while still responding to a sharp bend before the camera
 * reaches it. `totalLengthMeters` lets us convert that metre window into a
 * progress-space delta.
 */
export const routeCurvatureAt = (
  curve: RouteCurve,
  progress: number,
  totalLengthMeters: number,
  lookAheadMetres = 3,
): number => {
  if (totalLengthMeters <= 0) return 0;
  const dProg = lookAheadMetres / totalLengthMeters;
  const before = Math.max(0, progress - dProg);
  const after = Math.min(1, progress + dProg);
  const span = after - before;
  if (span <= 0) return 0;
  const spanMetres = span * totalLengthMeters;
  const scratchA = { position: vec3() as Vec3, tangent: vec3() as Vec3, angle: 0 };
  const scratchB = { position: vec3() as Vec3, tangent: vec3() as Vec3, angle: 0 };
  const a = curve.sample(before, scratchA);
  const b = curve.sample(after, scratchB);
  return angleDiff(a.angle, b.angle) / spanMetres;
};

/**
 * Convert signed curvature into a roll angle in radians. The response is
 * `atan(curvature * gain)` so straight-ish routes (curvature → 0) read as
 * flat and a sharp bend (curvature → ∞) asymptotes to `maxRollRadians`
 * rather than jumping. The sign is flipped so left turns (positive
 * curvature by `routeCurvatureAt`'s convention) produce a NEGATIVE roll
 * about the boat's local +Z axis, which heels the boat to port — into
 * the turn.
 *
 * Defaults are tuned for a chase-camera read at typical river scale:
 * `gain = 60 m` makes a 1°/m bend (sharp for a river) roll by ~45° * tanh,
 * clamped to a maximum of 8° so even very tight corners don't tip over.
 */
export const boatRollRadians = (
  curvature: number,
  gainMetres = 60,
  maxRollRadians = (8 * Math.PI) / 180,
): number => {
  if (!Number.isFinite(curvature) || curvature === 0) return 0;
  const soft = Math.atan(curvature * gainMetres);
  const clamped = clamp(soft, -maxRollRadians, maxRollRadians);
  return -clamped;
};
