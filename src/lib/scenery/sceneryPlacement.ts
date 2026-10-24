/**
 * Three-free port of `src/components/rower3d/sceneryPlacement.ts`.
 *
 * Walks the route curve (or a flat fallback band) and emits a `Placement[]`
 * list of GLB model instances for every scenery category (bank-edge,
 * scatter, trees, buildings, landform, backdrop, surface, inWater,
 * furniture). The engine's `sceneryMesh` pass consumes the output through
 * the mesh registry — each `Placement.id` is a `SceneryModelId` the engine
 * loaded + registered at attach.
 *
 * The schedule, seeds, band offsets, scaling, yaw convention and
 * thinToCeiling behaviour mirror the React layout tree-for-tree; a parity
 * Vitest asserts the first ~100 placements agree on id, position and
 * rotation for a fixed route + seed.
 */

import type { RouteCurve } from '../renderer/math/curve';
import { vec3 } from '../renderer/math/vec3';
import type { ResolvedScenery, SceneryModelId } from '../../components/rower3d/sceneryAssets';
import { trackProfiles, type SceneryTrack } from '../../components/rower3d/sceneryTrack';
import { getSegmentSceneryProfile } from '../../components/rower3d/segmentScenery';
import {
  buildTerrainProfile,
  getTerrainReliefForProgress,
  type RouteEnrichmentData,
  type SceneryProfile,
} from '../services/routeEnrichmentService';
import { seededRandom } from './seededRandom';

export const ASSET_SCALE = 0.001;

export type Category = keyof ResolvedScenery;

export const CATEGORY_OFFSET: Record<Category, [number, number]> = {
  surface: [0, 6],
  inWater: [0, 5],
  bankEdge: [6, 11],
  furniture: [8, 15],
  scatter: [15, 35],
  buildings: [45, 95],
  trees: [40, 110],
  landform: [115, 150],
  backdrop: [195, 240],
};

export const LAND_BANDS: readonly Category[] = [
  'bankEdge', 'furniture', 'scatter', 'trees', 'buildings', 'landform', 'backdrop',
];

const MIN_BAND_STEP_METRES = 1;
const SCENERY_WATER_MARGIN_METRES = 2;
const DEFAULT_WATER_WIDTH_METERS = 20;

const nearestBankOffset = (halfWidth: number): number => halfWidth + SCENERY_WATER_MARGIN_METRES;
const sideOfOffset = (offset: number): 'left' | 'right' => (offset < 0 ? 'left' : 'right');

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

export const bandsClearOf = (halfWidth: number): Record<Category, [number, number]> => {
  const bands = { ...CATEGORY_OFFSET };
  let previousInner = Number.NEGATIVE_INFINITY;
  for (const cat of LAND_BANDS) {
    const [oMin, oMax] = CATEGORY_OFFSET[cat];
    const inner = Math.max(oMin, nearestBankOffset(halfWidth), previousInner + MIN_BAND_STEP_METRES);
    bands[cat] = [inner, oMax + (inner - oMin)];
    previousInner = inner;
  }
  return bands;
};

export type Footing = 'bank' | 'water';
const footingOf = (cat: Category): Footing => (cat === 'surface' || cat === 'inWater' ? 'water' : 'bank');

export const CATEGORY_FACE: Record<Category, boolean> = {
  surface: false, inWater: false, bankEdge: true, furniture: true, scatter: false,
  trees: false, landform: true, backdrop: true, buildings: true,
};

export const SCHEDULE: Category[] = [
  'bankEdge', 'scatter', 'trees', 'scatter', 'bankEdge', 'trees', 'surface', 'scatter',
];

export interface Placement {
  id: SceneryModelId;
  position: [number, number, number];
  rotationY: number;
  scale: number;
  progress: number;
  footing: Footing;
}

export const MAX_INSTANCES_PER_SIDE = 900;
export const MAX_SAMPLE_BANDS = 22;

export const thinToCeiling = (
  placements: Placement[],
  ceiling: number = MAX_INSTANCES_PER_SIDE,
): Placement[] => {
  if (placements.length <= ceiling) return placements;
  const stride = placements.length / ceiling;
  const kept: Placement[] = [];
  for (let i = 0; kept.length < ceiling && Math.floor(i * stride) < placements.length; i += 1) {
    kept.push(placements[Math.floor(i * stride)]);
  }
  return kept;
};

export const pick = (ids: SceneryModelId[], seed: number): SceneryModelId | null =>
  ids.length === 0 ? null : ids[Math.floor(seededRandom(seed) * ids.length)];

/** Mirror of `src/components/rower3d/sceneryPlacement.ts`'s `SCENERY_BUDGET`. */
export type PerformanceMode = 'basic' | 'low' | 'medium' | 'high' | 'extra-high';
const SCENERY_BUDGET: Record<PerformanceMode, number> = {
  basic: 0.4, low: 0.5, medium: 0.7, high: 0.85, 'extra-high': 1,
};
export const budgetFor = (mode: PerformanceMode): number => SCENERY_BUDGET[mode] ?? SCENERY_BUDGET.medium;
export const keepsKitTrees = (mode: PerformanceMode): boolean => mode === 'high' || mode === 'extra-high';

export const distinctProfiles = (
  enrichment?: RouteEnrichmentData | null,
  track?: SceneryTrack | null,
): SceneryProfile[] => {
  if (track) return trackProfiles(track);
  const set = new Set<SceneryProfile>();
  for (const s of enrichment?.segmentProfiles ?? []) set.add(s.sceneryProfile);
  if (set.size === 0) set.add('fallback');
  return Array.from(set);
};

export interface PlacementInput {
  curve?: RouteCurve | null;
  enrichment?: RouteEnrichmentData | null;
  resolvedByProfile: Map<SceneryProfile, ResolvedScenery>;
  budget: number;
  side: 'left' | 'right';
  track?: SceneryTrack | null;
  kitTrees?: boolean;
}

export const computePlacements = (input: PlacementInput): Placement[] => {
  const { curve, enrichment, resolvedByProfile, budget, side, track = null, kitTrees = true } = input;
  const out: Placement[] = [];
  const firstResolved = resolvedByProfile.values().next().value as ResolvedScenery | undefined;
  const fallback = resolvedByProfile.get('fallback') ?? firstResolved;

  const noPlace = (..._args: Parameters<typeof place>) => {};

  const place = (
    cat: Category, sign: number, t: number,
    px: number, pz: number, perpX: number, perpZ: number, py: number,
    baseRot: number, seed: number, resolved: ResolvedScenery,
  ) => {
    const id = pick(resolved[cat] as SceneryModelId[], seed);
    if (!id) return;
    const [oMin, oMax] = bandsClearOf(waterHalfWidthAt(enrichment, t, sideOfOffset(sign)))[cat];
    const offset = sign * (oMin + seededRandom(seed + 1) * (oMax - oMin));
    const x = px + perpX * offset;
    const z = pz + perpZ * offset;
    const y = cat === 'surface' ? 0.15 : py;
    const faceWater = sign < 0 ? Math.PI / 2 : -Math.PI / 2;
    const rotationY = CATEGORY_FACE[cat]
      ? baseRot + faceWater + (seededRandom(seed + 2) - 0.5) * 0.4
      : seededRandom(seed + 2) * Math.PI * 2;
    const scale = ASSET_SCALE * (0.8 + seededRandom(seed + 3) * 0.5);
    out.push({ id, position: [x, y, z], rotationY, scale, progress: t, footing: footingOf(cat) });
  };

  if (curve) {
    const terrain = buildTerrainProfile(enrichment?.elevations);
    const wantSign = side === 'left' ? -1 : 1;
    const stepCount = Math.max(6, Math.round(MAX_SAMPLE_BANDS * budget));
    const sample = { position: vec3(), tangent: vec3(0, 0, -1), angle: 0 };
    let seed = 100;
    for (let i = 0; i <= stepCount; i++) {
      const t = i / stepCount;
      curve.sample(Math.min(0.999, t), sample);
      // Left-hand perpendicular (tangent × up) = (−tz, 0, tx).
      const perpX = -sample.tangent[2];
      const perpZ = sample.tangent[0];
      const perpLen = Math.hypot(perpX, perpZ) || 1;
      const px = perpX / perpLen;
      const pz = perpZ / perpLen;
      const profile = getSegmentSceneryProfile(enrichment, t, track);
      const resolved = resolvedByProfile.get(profile) ?? fallback;
      if (!resolved) continue;
      const y = getTerrainReliefForProgress(terrain, t);
      const baseRot = Math.atan2(sample.tangent[0], sample.tangent[2]);
      for (const sign of [-1, 1]) {
        const put = sign === wantSign ? place : noPlace;
        const putTree = kitTrees ? put : noPlace;
        seed += 5;
        const cat = SCHEDULE[(i + (sign < 0 ? 0 : 4)) % SCHEDULE.length];
        (cat === 'trees' ? putTree : put)(cat, sign, t, sample.position[0], sample.position[2], px, pz, y, baseRot, seed, resolved);
        if (i % 3 === 0) { seed += 5; putTree('trees', sign, t, sample.position[0], sample.position[2], px, pz, y, baseRot, seed, resolved); }
        if (i % 6 === 0) { seed += 5; put('surface', sign, t, sample.position[0], sample.position[2], px, pz, y, baseRot, seed, resolved); }
        if (i % 8 === 0 && sign < 0) { seed += 5; put('landform', sign, t, sample.position[0], sample.position[2], px, pz, y, baseRot, seed, resolved); }
        if (i % 12 === 0 && sign > 0) { seed += 5; put('backdrop', sign, t, sample.position[0], sample.position[2], px, pz, y, baseRot, seed, resolved); }
        if (i % 5 === 0) { seed += 5; put('furniture', sign, t, sample.position[0], sample.position[2], px, pz, y, baseRot, seed, resolved); }
        if (i % 4 === 0) { seed += 5; put('buildings', sign, t, sample.position[0], sample.position[2], px, pz, y, baseRot, seed, resolved); }
      }
    }
  } else if (fallback) {
    const sign = side === 'left' ? -1 : 1;
    let seed = side === 'left' ? 1000 : 5000;
    const bands: Array<[Category, number]> = [
      ['surface', 4], ['bankEdge', 7], ['furniture', 5],
      ['scatter', 9], ['trees', 7], ['landform', 3], ['backdrop', 2],
    ];
    for (const [cat, baseCount] of bands) {
      const count = Math.max(1, Math.round(baseCount * budget));
      const step = 760 / count;
      for (let i = 0; i < count; i++) {
        seed += 5;
        const z = -380 + i * step + (seededRandom(seed) - 0.5) * step * 0.6;
        place(cat, sign, (z + 400) / 800, 0, z, 1, 0, 0, 0, seed, fallback);
      }
    }
  }
  return thinToCeiling(out);
};
