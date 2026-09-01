import * as THREE from 'three';
import { SCENE_SCALE, WATER_CHANNEL_WIDTH, RIVERBANK_WIDTH } from './constants';
import { WHOLE_ROUTE } from './geometryChunks';
import {
  sampleStripFrame,
  stripProgressAt,
  stripSegmentCount,
  type StripGeometryOptions,
} from './routeStripGeometry';
import {
  buildTerrainProfile,
  getTerrainReliefForProgress,
  getWaterWidthSceneUnitsForProgress,
} from '../../services/routeEnrichmentService';

// ============================================================================
// Pure riverbank geometry. Kept out of bankComponents.tsx so the terrain
// wiring (#202) can be asserted without a WebGL context, and so that file
// exports components only.
// ============================================================================

/** Scene height of the waterline; the inner edge of both banks sits here. */
export const BANK_WATERLINE_Y = -0.5;

/**
 * Builds one riverbank as a strip running from the waterline out to the top of
 * the bank. Extracted from the component so the terrain wiring can be asserted
 * without standing up a WebGL context.
 *
 * `range` builds a single chunk of the bank; the whole route is the default.
 */
export const createBankGeometry = (
  curve: THREE.CatmullRomCurve3,
  side: 'left' | 'right',
  { enrichment, range = WHOLE_ROUTE }: StripGeometryOptions = {},
): THREE.BufferGeometry => {
  const segments = stripSegmentCount(curve, range);
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  // Real elevations along the route (#202). Flat, or absent, leaves every
  // vertex exactly where it was before.
  const terrain = buildTerrainProfile(enrichment?.elevations);

  const point = new THREE.Vector3();
  const perp = new THREE.Vector3();
  const inner = new THREE.Vector3();
  const outer = new THREE.Vector3();

  for (let i = 0; i <= segments; i++) {
    const t = stripProgressAt(range, i, segments);
    sampleStripFrame(curve, t, point, perp);

    const waterWidth = getWaterWidthSceneUnitsForProgress(
      enrichment?.segmentProfiles,
      enrichment?.waterWidthMeters ?? WATER_CHANNEL_WIDTH / SCENE_SCALE,
      t,
    );
    const waterHalfWidth = waterWidth / 2;
    const bankWidth = Math.max(RIVERBANK_WIDTH * 0.25, waterWidth * 2.25);

    const outward = side === 'left' ? -1 : 1;
    inner.copy(point).addScaledVector(perp, outward * waterHalfWidth);
    outer.copy(point).addScaledVector(perp, outward * (waterHalfWidth + bankWidth));

    // The waterline is fixed, so the inner edge stays put and the bank climbs
    // away from it. Moving it would open a gap between land and water.
    inner.y = BANK_WATERLINE_Y;
    outer.y = BANK_WATERLINE_Y + getTerrainReliefForProgress(terrain, t);

    positions.push(inner.x, inner.y, inner.z);
    positions.push(outer.x, outer.y, outer.z);

    uvs.push(0, t * 10);
    uvs.push(1, t * 10);

    if (i < segments) {
      const base = i * 2;
      indices.push(base, base + 2, base + 1);
      indices.push(base + 1, base + 2, base + 3);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  // A sloped bank lit by hardcoded (0,1,0) normals reads as flat, so the
  // relief would be invisible in anything but silhouette.
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();

  return geometry;
};
