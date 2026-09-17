// ============================================================================
// DEBUG GUIDES FOR THE CHANNEL
//
// The rower and scull look off centre in the river on every route, and there
// was no way to check it by eye: the water renders close to white, so the far
// bank washes out and only the near one reads as an edge. Whether the boat sits
// on the centreline or beside it is then a matter of opinion about a
// screenshot.
//
// These draw the answer. Yellow down the middle of the channel, red along each
// water edge, at the waterline — so the boat's position relative to both is
// visible directly. Behind the debug toggle, off by default.
// ============================================================================

import * as THREE from 'three';
import { sampleStripFrame, stripProgressSchedule } from './routeStripGeometry';
import { WHOLE_ROUTE } from './geometryChunks';
import { SCENE_SCALE, WATER_CHANNEL_WIDTH } from './constants';
import {
  getWaterWidthSceneUnitsForProgress,
  type RouteEnrichmentData,
} from '../../services/routeEnrichmentService';

/** Yellow down the middle, red at the edges. */
export const GUIDE_COLOURS = {
  centre: '#ffd400',
  edge: '#ff2d2d',
} as const;

/** Just above the water, so the guides are not buried by it. */
const GUIDE_Y = 0.05;

export interface RiverGuides {
  centre: THREE.Vector3[];
  left: THREE.Vector3[];
  right: THREE.Vector3[];
}

/**
 * Points along the channel's centreline and its two water edges.
 *
 * The edges are computed the same way `createWaterChannelGeometry` computes
 * them — the same frame, the same half width — so a guide that disagrees with
 * the water means the water is wrong, not the guide.
 */
export const buildRiverGuides = (
  curve: THREE.CatmullRomCurve3 | null | undefined,
  enrichment?: RouteEnrichmentData | null,
): RiverGuides => {
  if (!curve) return { centre: [], left: [], right: [] };

  const schedule = stripProgressSchedule(curve, WHOLE_ROUTE);
  const centre: THREE.Vector3[] = [];
  const left: THREE.Vector3[] = [];
  const right: THREE.Vector3[] = [];

  const point = new THREE.Vector3();
  const perp = new THREE.Vector3();

  for (const t of schedule) {
    sampleStripFrame(curve, t, point, perp);

    // Same frame and same half width the water channel uses, so a guide that
    // disagrees with the water means the water is wrong, not the guide.
    const halfWidth =
      getWaterWidthSceneUnitsForProgress(
        enrichment?.segmentProfiles,
        enrichment?.waterWidthMeters ?? WATER_CHANNEL_WIDTH / SCENE_SCALE,
        t,
      ) / 2;

    centre.push(new THREE.Vector3(point.x, GUIDE_Y, point.z));
    left.push(
      new THREE.Vector3(point.x - perp.x * halfWidth, GUIDE_Y, point.z - perp.z * halfWidth),
    );
    right.push(
      new THREE.Vector3(point.x + perp.x * halfWidth, GUIDE_Y, point.z + perp.z * halfWidth),
    );
  }

  return { centre, left, right };
};

/**
 * A guide line, drawn over the water rather than inside it.
 *
 * `depthTest: false` and a high render order are the point: a guide buried in
 * the water surface answers nothing, which is the whole reason these exist.
 */
export const guideLine = (points: THREE.Vector3[], colour: string): THREE.Line => {
  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  const material = new THREE.LineBasicMaterial({ color: colour, depthTest: false });
  const line = new THREE.Line(geometry, material);
  line.renderOrder = 999;
  return line;
};
