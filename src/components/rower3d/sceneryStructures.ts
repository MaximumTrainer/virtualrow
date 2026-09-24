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
  type RouteEnrichmentData,
  type TerrainProfile,
} from '../../services/routeEnrichmentService';
import { nearestBankOffset, waterHalfWidthAt } from './sceneryClearance';
import { bridgeModelFor } from './sceneryCrossings';
import type { SceneryModelId } from './sceneryAssets';
import { ASSET_SCALE, type Placement } from './sceneryPlacement';
import { courseFurniture } from './courseFurniture';

export type StructureKind = 'bridge' | 'furniture' | 'landmark' | 'buoy';

export interface StructureRequest {
  id: SceneryModelId;
  /** Where along the route it belongs, 0–1. */
  progress: number;
  kind: StructureKind;
  /**
   * Which side of the rowed line (#336). Left out, a structure stands where
   * every structure did before there was a choice, which is `right`.
   */
  side?: 'left' | 'right';
}

/**
 * How far off the rowed line each kind sits, in scene units, where the water
 * is narrow enough to allow it.
 *
 * This is the nearest a structure is authored to stand, not where it ends up:
 * seven metres is inside anything wider than a stream, and on a 55 m river it
 * stood a landmark 20.5 m out in the water. Anything that does not span the
 * water is pushed out to the bank as well (#379).
 */
const KIND_OFFSET: Record<StructureKind, number> = {
  // A bridge spans the water, so it stands on the line the boat rows.
  bridge: 0,
  furniture: 7,
  // A hero that does not span the water stands on the bank, like furniture.
  landmark: 7,
  // A lane buoy floats beside the boat, clear of blades that reach about
  // 2.9 m either side of the hull (#336).
  buoy: 4.5,
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
  buoy: false,
};

/** Whether a kind floats in the water rather than standing on a bank (#336). */
const KIND_FLOATS: Record<StructureKind, boolean> = {
  bridge: false,
  furniture: false,
  landmark: false,
  buoy: true,
};

/** Bridges and landmarks are large structures; furniture is boat-sized. */
const KIND_SCALE: Record<StructureKind, number> = {
  bridge: ASSET_SCALE * 1.6,
  furniture: ASSET_SCALE,
  landmark: ASSET_SCALE * 1.6,
  buoy: ASSET_SCALE,
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
  // The finish tower is not here: it stands on the line itself, with the
  // buoys and the posts, in courseFurniture.ts (#336).
  finish: ['a08-umpire-launch', 'a09-gazebo-hexagonal', 'b04-boat-rack-outdoor'],
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

/**
 * The furniture every course carries, at the ends where it belongs, and — when
 * the route's length is known — the buoys, finish tower and distance posts
 * that mark the course itself (#336).
 */
export const courseStructures = (routeMeters?: number): StructureRequest[] => [
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
  ...courseFurniture(routeMeters ?? 0),
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
  /** The water the structures stand beside; its width decides where the bank is (#379). */
  enrichment?: RouteEnrichmentData | null,
): Placement[] => {
  if (!curve) return [];
  const up = new THREE.Vector3(0, 1, 0);

  return structures.map(({ id, progress, kind, side = 'right' }) => {
    const t = Math.max(0, Math.min(0.999, progress));
    const point = curve.getPointAt(t);
    const tangent = curve.getTangentAt(t).normalize();
    const perp = new THREE.Vector3().crossVectors(tangent, up).normalize();
    const spans = KIND_SPANS_WATER[kind];
    const floats = KIND_FLOATS[kind];
    const onWater = spans || floats;
    const halfWidth = waterHalfWidthAt(enrichment, t);
    // A buoy stays inside the water however narrow it is; anything on a bank
    // is pushed out past the water however wide it is (#379).
    const distance = spans
      ? KIND_OFFSET[kind]
      : floats
        ? Math.min(KIND_OFFSET[kind], halfWidth * 0.8)
        : Math.max(KIND_OFFSET[kind], nearestBankOffset(halfWidth));
    const sign = side === 'left' ? -1 : 1;
    const offset = sign * distance;
    // Anything standing on a bank rises with it, the way the scatter in
    // sceneryPlacement.ts and the bank strips already do. A deck that spans the
    // water is placed relative to the water, so it stays on the waterline
    // however high the valley sides go (review of #232).
    const y = onWater ? 0 : getTerrainReliefForProgress(terrain, t);

    return {
      id,
      position: [point.x + perp.x * offset, y, point.z + perp.z * offset] as [number, number, number],
      // A structure that spans the water lies across it; everything else faces
      // it, so the far bank turns the other way.
      rotationY: Math.atan2(tangent.x, tangent.z) + (spans ? 0 : (sign * Math.PI) / 2),
      scale: KIND_SCALE[kind],
      progress: t,
      footing: onWater ? ('water' as const) : ('bank' as const),
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
  /** The route's length, which decides where the distance posts go (#336). */
  routeMeters?: number;
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
  routeMeters,
}: RouteStructuresInput): StructureRequest[] => {
  if (side !== 'left' || !hasCurve) return [];
  return [
    ...crossingStructures(crossings),
    ...courseStructures(routeMeters),
    ...landmarkStructures(coordinates),
  ];
};
