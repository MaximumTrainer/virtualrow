// ============================================================================
// COURSE FURNITURE — what marks the course itself (#336): a buoy either side
// of the lane at the start and the finish, the finish tower on the line, and a
// distance post every 500 m.
//
// Pure: it says where along the route and on which side, and
// sceneryStructures.ts turns that into a transform.
// ============================================================================

import type { SceneryModelId } from './sceneryAssets';

/** `buoy` floats in the lane; `furniture` stands on the bank, facing the water. */
export type FurnitureKind = 'buoy' | 'furniture';

export interface Furniture {
  id: SceneryModelId;
  /** Where along the route, 0–1. */
  progress: number;
  side: 'left' | 'right';
  kind: FurnitureKind;
}

export const DISTANCE_POST_INTERVAL_METERS = 500;

/**
 * Every post is a cloned GLB resident on the GPU, so a long course gets them
 * at a wider multiple of 500 m rather than one every 500 m.
 */
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
