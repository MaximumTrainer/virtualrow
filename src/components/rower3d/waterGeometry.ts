import * as THREE from 'three';
import { SCENE_SCALE, WATER_CHANNEL_WIDTH } from './constants';
import { WHOLE_ROUTE } from './geometryChunks';
import {
  sampleStripFrame,
  stripProgressSchedule,
  type StripGeometryOptions,
} from './routeStripGeometry';
import {
  getWaterWidthSceneUnitsForProgress,
  type RouteEnrichmentData,
} from '../../services/routeEnrichmentService';

// ============================================================================
// Pure water-channel geometry. Kept out of waterComponents.tsx so the channel
// the rower actually rows down can be asserted without a WebGL context (#224).
// ============================================================================

/** Scene height of the channel surface. */
export const WATER_SURFACE_Y = -0.1;

const defaultWaterWidthMeters = (enrichment?: RouteEnrichmentData | null) =>
  enrichment?.waterWidthMeters ?? WATER_CHANNEL_WIDTH / SCENE_SCALE;

/**
 * Build the water channel as a flat ribbon along the curve, widening and
 * narrowing with the route's measured water width.
 */
export const createWaterChannelGeometry = (
  curve: THREE.CatmullRomCurve3,
  { enrichment, range = WHOLE_ROUTE }: StripGeometryOptions = {},
): THREE.BufferGeometry => {
  const schedule = stripProgressSchedule(curve, range);
  const segments = schedule.length - 1;
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  const point = new THREE.Vector3();
  const perp = new THREE.Vector3();
  const edge = new THREE.Vector3();

  for (let i = 0; i <= segments; i++) {
    const t = schedule[i];
    sampleStripFrame(curve, t, point, perp);

    const halfWidth =
      getWaterWidthSceneUnitsForProgress(
        enrichment?.segmentProfiles,
        defaultWaterWidthMeters(enrichment),
        t,
      ) / 2;

    for (const offset of [-halfWidth, halfWidth]) {
      edge.copy(point).addScaledVector(perp, offset);
      positions.push(edge.x, WATER_SURFACE_Y, edge.z);
      normals.push(0, 1, 0);
    }

    uvs.push(0, t, 1, t);

    if (i < segments) {
      const base = i * 2;
      // Wound to face the sky.
      //
      // The two vertices above run in the +perp direction, where the left bank
      // runs -perp - and mirroring a strip reverses which way its triangles
      // face. Sharing the bank's index order pointed every water triangle
      // down: the same mistake #269 found in the banks, in the strip beside
      // them (#284).
      //
      // It was invisible because the material is DoubleSide. That hides the
      // culling and not the shading - under DOUBLE_SIDED three negates the
      // normal for a back face, so the (0,1,0) written above was being flipped
      // to (0,-1,0) at shading time and the river was lit from underneath.
      indices.push(base, base + 1, base + 2);
      indices.push(base + 1, base + 3, base + 2);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();

  return geometry;
};
