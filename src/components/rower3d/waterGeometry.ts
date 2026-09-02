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
      indices.push(base, base + 2, base + 1);
      indices.push(base + 1, base + 2, base + 3);
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
