import { describe, it, expect } from 'vitest';
import { SCENE_SCALE } from '../utils/worldScale';
import { WATER_CHANNEL_WIDTH, RIVERBANK_WIDTH, LANDSCAPE_OFFSET } from '../components/rower3d/constants';
import { ASSET_SCALE } from '../components/rower3d/sceneryPlacement';
import {
  MIN_NAVIGABLE_WIDTH_METERS,
  OAR_REACH_METERS,
  bladeClearanceMeters,
} from '../components/rower3d/navigableWidth';
import { createRouteCurve, getCurveDistances } from '../components/rower3d/curve';
import type { Coordinate } from '../types';

/**
 * Issue #321 — one scene unit is one metre.
 *
 * The scene used to be built at three scales at once. The route curve, the
 * water and the banks ran at 1 unit = 10 m; the boat hull, its oars and the
 * camera at 1 unit = 1 m; the scenery kit at roughly 1 unit = 2.5 m. Every
 * visual complaint in #347 is downstream of that:
 *
 *  - at 2:00/500m the boat advanced 0.417 units/s along an 8-unit hull, so it
 *    took about 19 seconds to travel its own length. On water it takes two. The
 *    game felt ten times slower than the erg;
 *  - a 22 m tree came out about 9 units tall beside an 8-unit boat, which is
 *    why the trees looked boat-sized and hung in the sky;
 *  - `bladeClearanceMeters` divided by `SCENE_SCALE` to compare a channel
 *    measured in tens of metres against an oar measured in metres.
 *
 * These are the arithmetic facts the rest of the scene is tuned against. They
 * are asserted as physical quantities — metres of water, metres of tree, metres
 * of boat per second — rather than as the numbers the constants happen to hold,
 * so they keep meaning the same thing if the constants move again.
 */

/** A straight kilometre, laid out along a line of longitude. */
const straightKilometre = (): Coordinate[] => {
  // 1 degree of latitude is ~111.32 km, so 1000 m is ~0.008983 degrees.
  const metresPerDegreeLat = 111_320;
  return Array.from({ length: 11 }, (_, i) => ({
    lat: 51 + (i * 100) / metresPerDegreeLat,
    lng: -1,
  }));
};

describe('the world is built in metres', () => {
  it('measures a route curve in metres', () => {
    const curve = createRouteCurve(straightKilometre(), SCENE_SCALE);
    expect(curve, 'no curve was built').not.toBeNull();

    const distances = getCurveDistances(curve!);
    const lengthInUnits = distances[distances.length - 1];

    expect(
      lengthInUnits,
      'a kilometre of route should be a thousand scene units long',
    ).toBeGreaterThan(990);
    expect(lengthInUnits).toBeLessThan(1010);
  });

  // A 22 m tree is the case from the issue, and the one visible in
  // docs/screenshot-activity.png: at 0.0004 it came out about 8.8 units, which
  // beside an 8-unit boat is a tree the size of a boat.
  it('builds a 22 m tree 22 units tall', () => {
    const treeHeightMillimetres = 22_000;
    expect(ASSET_SCALE * treeHeightMillimetres).toBeGreaterThan(21);
    expect(ASSET_SCALE * treeHeightMillimetres).toBeLessThan(23);
  });

  // The floor exists so the blades are over water. It can only do that if it is
  // wider than the blades, which at 0.7 units against a 5.56 unit oar span it
  // was not.
  it('never draws a channel narrower than the oars', () => {
    expect(MIN_NAVIGABLE_WIDTH_METERS).toBeGreaterThan(2 * OAR_REACH_METERS);
  });

  it('reads a channel width in the units the scene builds it in', () => {
    // The narrowest channel the scene will draw, handed straight back to the
    // clearance function the way the frame loop hands it over.
    expect(bladeClearanceMeters(MIN_NAVIGABLE_WIDTH_METERS)).toBeCloseTo(0.75, 5);
  });

  // Nothing measured is the absence of a reading, not a clearance of zero — a
  // distinction #271 turned on.
  it('reports nothing measured as nothing measured', () => {
    expect(bladeClearanceMeters(Number.NaN)).toBeNaN();
  });

  /**
   * The scene's own distances, as metres.
   *
   * These were authored against the old ten-metre unit, so each was a tenth of
   * what its comment claimed: the water channel said "20 metres" and drew 200,
   * the landscape stood 500 m back from the water rather than 50.
   */
  it('lays the waterway out at the widths its comments claim', () => {
    /** What a distance authored in scene units really measures, in metres. */
    const metres = (sceneUnits: number) => sceneUnits / SCENE_SCALE;

    expect(metres(WATER_CHANNEL_WIDTH), 'the channel is 20 m of water').toBeCloseTo(20, 5);
    expect(metres(RIVERBANK_WIDTH), 'each bank is 60 m wide').toBeCloseTo(60, 5);
    expect(
      metres(LANDSCAPE_OFFSET),
      'the landscape starts 50 m from the centreline',
    ).toBeCloseTo(50, 5);
    expect(
      metres(WATER_CHANNEL_WIDTH),
      'the channel has to be wide enough for the oars it carries',
    ).toBeGreaterThan(MIN_NAVIGABLE_WIDTH_METERS);
  });
});
