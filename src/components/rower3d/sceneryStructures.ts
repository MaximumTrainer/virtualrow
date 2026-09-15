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
import {
  getTerrainReliefForProgress,
  type TerrainProfile,
} from '../../services/routeEnrichmentService';
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
  // A hero that does not span the water stands on the bank, like furniture.
  landmark: 7,
};

/**
 * Whether a kind crosses the water rather than standing beside it.
 *
 * This decides both the offset above and the yaw below, and the two used to
 * disagree: `landmark` was given a bridge's offset and scale but furniture's
 * "face the water" quarter turn. Every Tier L hero is a bridge, so Ponte
 * Isabella — authored exactly like the Tier C arch, span along X — was laid
 * *along* the rowed line instead of across it (review of #232).
 */
const KIND_SPANS_WATER: Record<StructureKind, boolean> = {
  bridge: true,
  furniture: false,
  landmark: false,
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
  /**
   * True when the real structure crosses the water. Declared per landmark
   * rather than inferred from the tier, so adding a lighthouse or a boathouse
   * to this table does not silently get a bridge's placement.
   */
  spansWater: boolean;
}

/** Tier L heroes, each pinned to the water it was built from. */
export const LIVERIED_LANDMARKS: LiveriedLandmark[] = [
  { id: 'l-barnes-railway-bridge', at: { lat: 51.4739, lng: -0.2463 }, label: 'Barnes Railway Bridge', spansWater: true },
  { id: 'l-fremont-bridge', at: { lat: 45.5383, lng: -122.6861 }, label: 'Fremont Bridge', spansWater: true },
  { id: 'l-ponte-isabella', at: { lat: 45.0447, lng: 7.6858 }, label: 'Ponte Isabella', spansWater: true },
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
        kind: (landmark.spansWater ? 'bridge' : 'landmark') as StructureKind,
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
  terrain?: TerrainProfile | null,
): Placement[] => {
  if (!curve) return [];
  const up = new THREE.Vector3(0, 1, 0);

  return structures.map(({ id, progress, kind }) => {
    const t = Math.max(0, Math.min(0.999, progress));
    const point = curve.getPointAt(t);
    const tangent = curve.getTangentAt(t).normalize();
    const perp = new THREE.Vector3().crossVectors(tangent, up).normalize();
    const spans = KIND_SPANS_WATER[kind];
    const offset = KIND_OFFSET[kind];
    // Anything standing on a bank rises with it, the way the scatter in
    // sceneryPlacement.ts and the bank strips already do. A deck that spans the
    // water is placed relative to the water, so it stays on the waterline
    // however high the valley sides go (review of #232).
    const y = spans ? 0 : getTerrainReliefForProgress(terrain, t);

    return {
      id,
      position: [point.x + perp.x * offset, y, point.z + perp.z * offset] as [number, number, number],
      // A structure that spans the water lies across it; everything else faces it.
      rotationY: Math.atan2(tangent.x, tangent.z) + (spans ? 0 : Math.PI / 2),
      scale: KIND_SCALE[kind],
      progress: t,
    };
  });
};

export interface RouteStructuresInput {
  side: 'left' | 'right';
  /**
   * Whether the scene has a route curve. Without one there is nowhere to put a
   * structure, and asking for them anyway put their GLBs in the component's
   * useGLTF list — so a straight-mode route downloaded and suspended on eight
   * models, two of them Tier B, to render none of them (review of #232).
   */
  hasCurve: boolean;
  coordinates?: Coordinate[] | null;
  crossings?: Crossing[] | null;
}

/**
 * Every one-off structure this route carries: the bridges it passes under, the
 * furniture at each end, and any liveried landmark this water owns.
 *
 * Placed once per route rather than per bank, so only one side asks for them.
 */
export const routeStructures = ({
  side,
  hasCurve,
  coordinates,
  crossings,
}: RouteStructuresInput): StructureRequest[] => {
  if (side !== 'left' || !hasCurve) return [];
  return [
    ...crossingStructures(crossings),
    ...courseStructures(),
    ...landmarkStructures(coordinates),
  ];
};
