/**
 * Three-free port of `src/components/rower3d/courseFurniture.ts`.
 *
 * Course furniture (#336) is what marks the course itself: a lane buoy on
 * each side at the start and the finish, a distance post every 500 m
 * (capped at `MAX_DISTANCE_POSTS` so a long course spaces them out), and
 * the finish tower on the finish line. The React side turns each entry
 * into a draw via `sceneryStructures.computeStructurePlacements`; we do
 * the equivalent in `placeFurniture` below.
 *
 * Pure TS: `src/components/rower3d/courseFurniture.ts` already imports
 * nothing from three, so this file keeps the exact types & values from
 * the original.
 */

import type { RouteCurve } from '../renderer/math/curve';
import { vec3 } from '../renderer/math/vec3';

/** The exact model-id set course furniture draws from. */
export type SceneryModelId =
  | 'a01-buoy-lane-sphere'
  | 'a06-finish-tower'
  | 'a07-distance-marker-post';

export type FurnitureKind = 'buoy' | 'furniture';

export interface Furniture {
  id: SceneryModelId;
  progress: number;
  side: 'left' | 'right';
  kind: FurnitureKind;
}

export const DISTANCE_POST_INTERVAL_METERS = 500;
export const MAX_DISTANCE_POSTS = 30;

const BUOY: SceneryModelId = 'a01-buoy-lane-sphere';
const POST: SceneryModelId = 'a07-distance-marker-post';
const TOWER: SceneryModelId = 'a06-finish-tower';

const buoyLine = (progress: number): Furniture[] => [
  { id: BUOY, progress, side: 'left', kind: 'buoy' },
  { id: BUOY, progress, side: 'right', kind: 'buoy' },
];

export const courseFurniture = (routeMeters: number): Furniture[] => {
  if (!Number.isFinite(routeMeters) || routeMeters <= 0) return [];

  const slots = Math.floor(routeMeters / DISTANCE_POST_INTERVAL_METERS);
  const interval = DISTANCE_POST_INTERVAL_METERS * Math.max(1, Math.ceil(slots / MAX_DISTANCE_POSTS));
  const posts = Math.floor(routeMeters / interval);

  return [
    ...buoyLine(0),
    ...Array.from({ length: posts }, (_, i) => ({
      id: POST,
      progress: ((i + 1) * interval) / routeMeters,
      side: 'left' as const,
      kind: 'furniture' as const,
    })),
    ...buoyLine(1),
    { id: TOWER, progress: 1, side: 'right', kind: 'furniture' },
  ];
};

/**
 * A placed furniture item in world space, ready for the engine's instanced-
 * mesh registry (lands with the engine-side pass). Position comes from the
 * route curve at `progress`, offset laterally by the side's buoy-lane width
 * (buoys) or the shore-plus-margin width (bank furniture).
 */
export interface FurniturePlacement {
  id: SceneryModelId;
  /** World-space [x, y, z]. */
  position: [number, number, number];
  /** Radians about Y: furniture faces the water (perp inward), buoys face the tangent. */
  rotationY: number;
  progress: number;
  side: 'left' | 'right';
  kind: FurnitureKind;
}

/** Lane half-width for buoys: a comfortable rowing lane either side of the centreline. */
export const BUOY_LANE_HALF_WIDTH_METRES = 6.5;
/** How far from the waterline course furniture stands on the bank. */
export const FURNITURE_BANK_OFFSET_METRES = 2;

export interface PlaceFurnitureInput {
  curve: RouteCurve;
  routeMeters: number;
  /** Per-side waterline half-width (scene units). Default: a symmetric 20 m channel. */
  shoreHalfWidth?: (progress: number, side: 'left' | 'right') => number;
}

export const placeFurniture = ({
  curve,
  routeMeters,
  shoreHalfWidth,
}: PlaceFurnitureInput): FurniturePlacement[] => {
  const defaults = (_t: number, _side: 'left' | 'right'): number => 10;
  const shore = shoreHalfWidth ?? defaults;
  const items = courseFurniture(routeMeters);
  const out: FurniturePlacement[] = [];
  const sample = { position: vec3(), tangent: vec3(0, 0, -1), angle: 0 };
  for (const f of items) {
    curve.sample(f.progress, sample);
    const perpX = -sample.tangent[2];
    const perpZ = sample.tangent[0];
    const perpLen = Math.hypot(perpX, perpZ) || 1;
    const px = perpX / perpLen;
    const pz = perpZ / perpLen;
    const sideSign = f.side === 'left' ? -1 : 1;
    const laneOffset = f.kind === 'buoy'
      ? BUOY_LANE_HALF_WIDTH_METRES
      : shore(f.progress, f.side) + FURNITURE_BANK_OFFSET_METRES;
    const tangentAngle = Math.atan2(sample.tangent[0], sample.tangent[2]);
    out.push({
      id: f.id,
      position: [
        sample.position[0] + px * sideSign * laneOffset,
        0,
        sample.position[2] + pz * sideSign * laneOffset,
      ],
      // Buoys face the tangent (streamlined with the current); bank furniture
      // faces the water (perp inward), so rotate 90° off the tangent.
      rotationY: f.kind === 'buoy' ? tangentAngle : tangentAngle + sideSign * (Math.PI / 2),
      progress: f.progress,
      side: f.side,
      kind: f.kind,
    });
  }
  return out;
};
