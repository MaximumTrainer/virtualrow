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
