// ============================================================================
// ENOUGH WATER TO ROW ON
//
// A rigged single sculls with its blades 2.78 m either side of the centreline:
// 0.80 m from centre to the gate, 1.98 m from gate to blade tip, both authored
// in scripts/build_crew.py and validated against real dimensions in #245. Tip
// to tip that is 5.56 m.
//
// Nothing compared that against the channel. The boat is placed on the route
// curve and the water is built symmetrically about it, so a segment reporting a
// narrower waterway simply put the blades over land — and since the bank is
// drawn from the same width, they were over the bank rather than beside it
// (#271).
//
// Real waterways are genuinely narrower than this sometimes; a stream defaults
// to 7 m and OSM can report less. The choice made here is to widen the rendered
// channel rather than narrow the boat: a scull with stunted oars is a worse lie
// than a stream drawn a little generously, and the rowing model is unaffected
// either way.
// ============================================================================

/** Centre to blade tip: gate offset plus outboard, from the rig. */
export const OAR_REACH_METERS = 0.8 + 1.98;

/** Clearance beyond the blade tip, so the blades are on water and not at its edge. */
const BLADE_CLEARANCE_METERS = 0.75;

/** The narrowest channel the scene will draw. */
export const MIN_NAVIGABLE_WIDTH_METERS = (OAR_REACH_METERS + BLADE_CLEARANCE_METERS) * 2;

/**
 * The width to draw a channel, given what the route reported.
 *
 * Wider channels pass through untouched — widening a river that is already wide
 * enough would be inventing water.
 */
export const navigableWaterWidthMeters = (reportedMeters: number): number => {
  if (!Number.isFinite(reportedMeters) || reportedMeters <= 0) {
    return MIN_NAVIGABLE_WIDTH_METERS;
  }
  return Math.max(reportedMeters, MIN_NAVIGABLE_WIDTH_METERS);
};

/**
 * How much water is left beyond the blade tip, in metres.
 *
 * The floor above proves the arithmetic. It cannot prove the scene applies it:
 * the water, both banks and the debug guides each read the width for
 * themselves, and #271's last acceptance point is about where the boat sits
 * between the red edges rather than about what a function returns. Rower3D
 * publishes this from the frame loop at the boat's own progress, so an E2E can
 * watch the running game instead of re-deriving it.
 *
 * Takes scene units because that is what `getWaterWidthSceneUnitsForProgress`
 * hands back, and converting at the call-site is where a factor of ten gets
 * lost. A unit is a metre since #321, so there is no conversion left to lose -
 * dividing by `SCENE_SCALE` here would be dividing by one, and a division by a
 * constant that is currently 1 is the kind of leftover that comes back to life
 * the next time somebody changes the constant.
 *
 * Negative means the blades are over land, which is the fault #271 reported;
 * NaN means nothing was measured, which is not the same thing and must not read
 * as a clearance of zero.
 */
export const bladeClearanceMeters = (channelWidthSceneUnits: number): number => {
  if (!Number.isFinite(channelWidthSceneUnits)) return Number.NaN;
  return channelWidthSceneUnits / 2 - OAR_REACH_METERS;
};
