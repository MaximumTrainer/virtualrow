// ============================================================================
// COURSE STRUCTURES — the one-off buildings a route carries, rather than the
// scatter that dresses its banks.
//
// Tier A regatta furniture, Tier B boathouses, Tier C bridges and the three
// Tier L liveried landmarks all sit at a particular point on a particular
// course: the stakeboats at the start, the finish tower at the finish, a bridge
// where the water passes under one, Barnes Railway Bridge only at Barnes. The
// per-segment scatter in sceneryPlacement.ts cannot express that, which is why
// 31 of these models were never placed (issue #232).
// ============================================================================

import * as THREE from 'three';
import type { Coordinate } from '../../types/index';
import { distanceBetweenLatLng } from '../../utils/geoUtils';
import type { Crossing } from '../../utils/bridgeCrossings';
import { bridgeModelFor } from './sceneryCrossings';
import type { SceneryModelId } from './sceneryAssets';
import { ASSET_SCALE, type Placement } from './sceneryPlacement';

export type StructureKind = 'bridge' | 'furniture' | 'landmark';

export interface StructureRequest {
  id: SceneryModelId;
  /** Where along the route it belongs, 0–1. */
  progress: number;
  kind: StructureKind;
}

/** How far off the rowed line each kind sits, in scene units. */
const KIND_OFFSET: Record<StructureKind, number> = {
  // A bridge spans the water, so it stands on the line the boat rows.
  bridge: 0,
  furniture: 7,
  landmark: 0,
};

/** Bridges and landmarks are large structures; furniture is boat-sized. */
const KIND_SCALE: Record<StructureKind, number> = {
  bridge: ASSET_SCALE * 1.6,
  furniture: ASSET_SCALE,
  landmark: ASSET_SCALE * 1.6,
};

/**
 * What a rowing course has at each end. The start is a launching and marshalling
 * area, the finish is the tower and the crowd.
 */
export const COURSE_FURNITURE: { start: SceneryModelId[]; finish: SceneryModelId[] } = {
  start: [
    'b02-boathouse-uk-victorian',
    'a03-pontoon-floating-dock',
    'a05-stakeboat-platform',
    'a10-slipway-ramp',
  ],
  finish: ['a06-finish-tower', 'a08-umpire-launch', 'a09-gazebo-hexagonal', 'b04-boat-rack-outdoor'],
};

export interface LiveriedLandmark {
  id: SceneryModelId;
  /** The real structure's position; the route must pass close to earn it. */
  at: Coordinate;
  label: string;
}

/** Tier L heroes, each pinned to the water it was built from. */
export const LIVERIED_LANDMARKS: LiveriedLandmark[] = [
  { id: 'l-barnes-railway-bridge', at: { lat: 51.4739, lng: -0.2463 }, label: 'Barnes Railway Bridge' },
  { id: 'l-fremont-bridge', at: { lat: 45.5383, lng: -122.6861 }, label: 'Fremont Bridge' },
  { id: 'l-ponte-isabella', at: { lat: 45.0447, lng: 7.6858 }, label: 'Ponte Isabella' },
];

/** A landmark further than this from the route belongs to someone else's water. */
const LANDMARK_RADIUS_METERS = 1500;

/** The furniture every course carries, at the ends where it belongs. */
export const courseStructures = (): StructureRequest[] => [
  ...COURSE_FURNITURE.start.map((id, i) => ({
    id,
    progress: 0.02 + i * 0.012,
    kind: 'furniture' as const,
  })),
  ...COURSE_FURNITURE.finish.map((id, i) => ({
    id,
    progress: 0.98 - i * 0.012,
    kind: 'furniture' as const,
  })),
];

/** Landmarks this route actually rows past. */
export const landmarkStructures = (coordinates?: Coordinate[] | null): StructureRequest[] => {
  const route = (coordinates ?? []).filter(
    (c) => Number.isFinite(c?.lat) && Number.isFinite(c?.lng),
  );
  if (route.length < 2) return [];

  return LIVERIED_LANDMARKS.flatMap((landmark) => {
    let nearest = { metres: Number.POSITIVE_INFINITY, index: 0 };
    route.forEach((point, index) => {
      const metres = distanceBetweenLatLng(point.lat, point.lng, landmark.at.lat, landmark.at.lng);
      if (metres < nearest.metres) nearest = { metres, index };
    });

    if (nearest.metres > LANDMARK_RADIUS_METERS) return [];
    return [
      {
        id: landmark.id,
        progress: nearest.index / (route.length - 1),
        kind: 'landmark' as const,
      },
    ];
  });
};

/** The Tier C model for each bridge the route passes under. */
export const crossingStructures = (crossings?: Crossing[] | null): StructureRequest[] =>
  (crossings ?? []).map(({ progress, kind }) => ({
    id: bridgeModelFor(kind),
    progress,
    kind: 'bridge' as const,
  }));

/**
 * Position each structure on the route curve. Pure — no R3F, no GLB loading —
 * and deterministic, so a course looks the same on every visit.
 */
export const computeStructurePlacements = (
  curve: THREE.Curve<THREE.Vector3> | null | undefined,
  structures: StructureRequest[],
): Placement[] => {
  if (!curve) return [];
  const up = new THREE.Vector3(0, 1, 0);

  return structures.map(({ id, progress, kind }) => {
    const t = Math.max(0, Math.min(0.999, progress));
    const point = curve.getPointAt(t);
    const tangent = curve.getTangentAt(t).normalize();
    const perp = new THREE.Vector3().crossVectors(tangent, up).normalize();
    const offset = KIND_OFFSET[kind];

    return {
      id,
      position: [point.x + perp.x * offset, 0, point.z + perp.z * offset] as [number, number, number],
      // Bridges lie across the water; everything else faces it.
      rotationY: Math.atan2(tangent.x, tangent.z) + (kind === 'bridge' ? 0 : Math.PI / 2),
      scale: KIND_SCALE[kind],
      progress: t,
    };
  });
};
