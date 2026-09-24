import { sunPositionFrom } from './conditions';
import type { LightingConfig } from './themeConfig';

/**
 * Where the sun is, and where the light that casts its shadow has to stand
 * (issue #352).
 *
 * The directional light sat at a fixed position with a ±60 m shadow camera
 * around the origin and no `target`, so it pointed at the origin whatever the
 * boat did. A boat rows away from the origin: past about 60 m everything left
 * the frustum and the row finished with no shadows at all. Nothing caught it
 * because every published screenshot is taken in the first few seconds, while
 * the boat is still on the start.
 *
 * A directional light has no position in the physics — only a direction — so
 * moving it with the boat changes nothing about how the scene is lit. What it
 * changes is where the shadow map is *aimed*.
 */

/**
 * How far up-sun of the boat the light stands, in metres.
 *
 * Far enough that everything between it and the boat — the far bank, a bridge,
 * a boathouse roof — is still in front of the near plane and can cast into the
 * scene.
 */
export const SUN_LIGHT_DISTANCE_M = 150;

/**
 * Half the shadow camera's width, in metres.
 *
 * Tighter than the ±60 it replaces. The frustum is centred on the boat now
 * rather than on the origin, so the texels no longer have to cover ground the
 * camera will never look at, and the same map is sharper over the water the
 * rower is actually on.
 */
export const SHADOW_HALF_EXTENT_M = 45;

/** A unit vector from the scene towards the sun. */
export const sunDirection = (lighting: LightingConfig): [number, number, number] =>
  // The same two angles the sky's own disc is placed from (#346), at unit
  // length: one sun, so a shadow points away from the bright spot rather than
  // off at an angle of its own.
  sunPositionFrom(lighting.sunElevation, lighting.sunAzimuth, 1);

/** Where the light stands so that it is up-sun of the boat. */
export const followerLightPosition = (
  boat: readonly [number, number, number] | number[],
  direction: readonly [number, number, number],
  distance = SUN_LIGHT_DISTANCE_M,
): [number, number, number] => [
  boat[0] + direction[0] * distance,
  boat[1] + direction[1] * distance,
  boat[2] + direction[2] * distance,
];

/**
 * Whether the boat falls inside the shadow camera aimed at `target`.
 *
 * Measured across the ground only. The shadow camera is orthographic and its
 * depth is the `far` plane rather than the extent, so height above the target
 * does not put anything outside it.
 *
 * Trivially true once the light follows the boat, which is the point: it was
 * false for every boat more than 60 m from the origin, and this is what the
 * endurance spec asserts at a third, a half and the end of a row.
 */
export const shadowFrustumCoversBoat = (
  boat: readonly [number, number, number] | number[],
  target: readonly [number, number, number] | number[],
  halfExtent = SHADOW_HALF_EXTENT_M,
): boolean =>
  Math.abs(boat[0] - target[0]) <= halfExtent && Math.abs(boat[2] - target[2]) <= halfExtent;

/**
 * How far out the sky's sun disc is placed.
 *
 * three's `Sky` normalises this internally, so the magnitude only has to be
 * clear of the geometry. Kept at what the retired `sky.sunPosition` field
 * used, so nothing about the sky's appearance changes with its removal.
 */
export const SKY_SUN_DISTANCE = 110;

/**
 * Where the sky draws its sun disc, from the lighting angles.
 *
 * The only way to get one now that `SkyConfig.sunPosition` is gone (#352):
 * a second field is a second answer, and the two disagreed for as long as
 * both existed.
 */
export const skySunPosition = (lighting: LightingConfig): [number, number, number] =>
  sunPositionFrom(lighting.sunElevation, lighting.sunAzimuth, SKY_SUN_DISTANCE);
