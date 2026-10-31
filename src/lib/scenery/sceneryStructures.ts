/**
 * Three-free port of `src/components/rower3d/sceneryStructures.ts`.
 *
 * Course-level structures (bridges, boathouses, finish tower, buoys and
 * liveried landmarks) placed as `Placement`s on the engine's `RouteCurve`.
 * Reuses the React tree's `COURSE_FURNITURE`, `LIVERIED_LANDMARKS`,
 * `KIND_OFFSET`/`KIND_SCALE`/`KIND_SPANS_WATER`/`KIND_FLOATS` directly
 * (that file is three-free data).
 */

import type { RouteCurve } from '../renderer/math/curve';
import { vec3 } from '../renderer/math/vec3';
import type { Coordinate } from '../types/index';
import { distanceBetweenLatLng } from '../utils/geoUtils';
import type { Crossing } from '../utils/bridgeCrossings';
import {
  getTerrainReliefForProgress,
  type RouteEnrichmentData,
  type TerrainProfile,
} from '../services/routeEnrichmentService';
import type { SceneryModelId } from '../../components/rower3d/sceneryAssets';
import { bridgeModelFor } from '../../components/rower3d/sceneryCrossings';
import { ASSET_SCALE, type Placement } from './sceneryPlacement';
import { courseFurniture } from './courseFurniture';

export type StructureKind = 'bridge' | 'furniture' | 'landmark' | 'buoy';

export interface StructureRequest {
  id: SceneryModelId;
  progress: number;
  kind: StructureKind;
  side?: 'left' | 'right';
}

const KIND_OFFSET: Record<StructureKind, number> = {
  bridge: 0, furniture: 7, landmark: 7, buoy: 4.5,
};

const KIND_SPANS_WATER: Record<StructureKind, boolean> = {
  bridge: true, furniture: false, landmark: false, buoy: false,
};

const KIND_FLOATS: Record<StructureKind, boolean> = {
  bridge: false, furniture: false, landmark: false, buoy: true,
};

const KIND_SCALE: Record<StructureKind, number> = {
  bridge: ASSET_SCALE * 1.6, furniture: ASSET_SCALE, landmark: ASSET_SCALE * 1.6, buoy: ASSET_SCALE,
};

export const COURSE_FURNITURE: { start: SceneryModelId[]; finish: SceneryModelId[] } = {
  start: [
    'b02-boathouse-uk-victorian',
    'a03-pontoon-floating-dock',
    'a05-stakeboat-platform',
    'a10-slipway-ramp',
  ],
  finish: ['a08-umpire-launch', 'a09-gazebo-hexagonal', 'b04-boat-rack-outdoor'],
};

export interface LiveriedLandmark {
  id: SceneryModelId;
  at: Coordinate;
  label: string;
  spansWater: boolean;
}

export const LIVERIED_LANDMARKS: LiveriedLandmark[] = [
  { id: 'l-barnes-railway-bridge', at: { lat: 51.4739, lng: -0.2463 }, label: 'Barnes Railway Bridge', spansWater: true },
  { id: 'l-fremont-bridge', at: { lat: 45.5383, lng: -122.6861 }, label: 'Fremont Bridge', spansWater: true },
  { id: 'l-ponte-isabella', at: { lat: 45.0447, lng: 7.6858 }, label: 'Ponte Isabella', spansWater: true },
];

const LANDMARK_RADIUS_METERS = 1500;
const SCENERY_WATER_MARGIN_METRES = 2;
const DEFAULT_WATER_WIDTH_METERS = 20;

const nearestBankOffset = (halfWidth: number): number => halfWidth + SCENERY_WATER_MARGIN_METRES;

const waterHalfWidthAt = (
  enrichment: RouteEnrichmentData | null | undefined,
  progress: number,
  side: 'left' | 'right',
): number => {
  const profiles = enrichment?.segmentProfiles;
  if (!profiles || profiles.length === 0) {
    return (enrichment?.waterWidthMeters ?? DEFAULT_WATER_WIDTH_METERS) / 2;
  }
  const clamped = Math.max(0, Math.min(1, progress));
  const lastIndex = profiles.length - 1;
  const scaled = clamped * lastIndex;
  const lower = profiles[Math.floor(scaled)];
  const upper = profiles[Math.min(lastIndex, Math.floor(scaled) + 1)];
  const blend = scaled - Math.floor(scaled);
  const lo = (side === 'left' ? lower.leftShoreMeters : lower.rightShoreMeters) ?? 0;
  const hi = (side === 'left' ? upper.leftShoreMeters : upper.rightShoreMeters) ?? 0;
  const meters = lo + (hi - lo) * blend;
  return Number.isFinite(meters) && meters > 0 ? meters : DEFAULT_WATER_WIDTH_METERS / 2;
};

export const courseStructures = (routeMeters?: number): StructureRequest[] => [
  ...COURSE_FURNITURE.start.map((id, i) => ({
    id, progress: 0.02 + i * 0.012, kind: 'furniture' as const,
  })),
  ...COURSE_FURNITURE.finish.map((id, i) => ({
    id, progress: 0.98 - i * 0.012, kind: 'furniture' as const,
  })),
  ...courseFurniture(routeMeters ?? 0).map((f) => ({
    id: f.id as SceneryModelId,
    progress: f.progress,
    kind: (f.kind === 'buoy' ? 'buoy' : 'furniture') as StructureKind,
    side: f.side,
  })),
];

/**
 * #567 slice "Landmark GLB chunks" — the three liveried landmarks are
 * resolved to `StructureRequest`s whenever a route's coordinates pass
 * within `LANDMARK_RADIUS_METERS` of their canonical lat/lng. The
 * `rideScene` loader resolves `l-*` ids to `public/assets/scenery/
 * tier-l/<id>.glb` via `tierFolderFor`, parses via `glbLoader.loadGlb`
 * (meshopt + mesh-quantization decode, hand-written, no three.js), and
 * registers the result with the sceneryMesh pass just like a bridge or
 * boathouse. `landmarkGlb.test.ts` guards the loader → budget → bounds
 * contract end-to-end.
 */
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
    return [{
      id: landmark.id,
      progress: nearest.index / (route.length - 1),
      kind: (landmark.spansWater ? 'bridge' : 'landmark') as StructureKind,
    }];
  });
};

export const crossingStructures = (crossings?: Crossing[] | null): StructureRequest[] =>
  (crossings ?? []).map(({ progress, kind }) => ({
    id: bridgeModelFor(kind), progress, kind: 'bridge' as const,
  }));

export const computeStructurePlacements = (
  curve: RouteCurve | null | undefined,
  structures: StructureRequest[],
  terrain?: TerrainProfile | null,
  enrichment?: RouteEnrichmentData | null,
): Placement[] => {
  if (!curve) return [];
  const sample = { position: vec3(), tangent: vec3(0, 0, -1), angle: 0 };
  return structures.map(({ id, progress, kind, side = 'right' }) => {
    const t = Math.max(0, Math.min(0.999, progress));
    curve.sample(t, sample);
    // tangent × up with up=(0,1,0) → (−tz, 0, tx).
    const perpX = -sample.tangent[2];
    const perpZ = sample.tangent[0];
    const perpLen = Math.hypot(perpX, perpZ) || 1;
    const px = perpX / perpLen;
    const pz = perpZ / perpLen;
    const spans = KIND_SPANS_WATER[kind];
    const floats = KIND_FLOATS[kind];
    const onWater = spans || floats;
    const halfWidth = waterHalfWidthAt(enrichment, t, side);
    const distance = spans
      ? KIND_OFFSET[kind]
      : floats
        ? Math.min(KIND_OFFSET[kind], halfWidth * 0.8)
        : Math.max(KIND_OFFSET[kind], nearestBankOffset(halfWidth));
    const sign = side === 'left' ? -1 : 1;
    const offset = sign * distance;
    const y = onWater ? 0 : getTerrainReliefForProgress(terrain, t);
    return {
      id,
      position: [sample.position[0] + px * offset, y, sample.position[2] + pz * offset] as [number, number, number],
      rotationY: Math.atan2(sample.tangent[0], sample.tangent[2]) + (spans ? 0 : (sign * Math.PI) / 2),
      scale: KIND_SCALE[kind],
      progress: t,
      footing: onWater ? ('water' as const) : ('bank' as const),
    };
  });
};

export interface RouteStructuresInput {
  side: 'left' | 'right';
  hasCurve: boolean;
  coordinates?: Coordinate[] | null;
  crossings?: Crossing[] | null;
  routeMeters?: number;
}

export const routeStructures = ({
  side, hasCurve, coordinates, crossings, routeMeters,
}: RouteStructuresInput): StructureRequest[] => {
  if (side !== 'left' || !hasCurve) return [];
  return [
    ...crossingStructures(crossings),
    ...courseStructures(routeMeters),
    ...landmarkStructures(coordinates),
  ];
};
