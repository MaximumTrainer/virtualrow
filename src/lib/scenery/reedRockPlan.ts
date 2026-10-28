/**
 * Reed and rock placement along the water edge (#591 follow-up), ported
 * from `src/components/rower3d/vegetationComponents.tsx` on the sibling
 * React main. Both layers are placed deterministically along the route
 * curve, so a given route+seed produces the same positions on every run
 * (and across both engines, future tests can assert tree-vs-reed
 * independence like the existing foliage parity).
 *
 * React's layout works around a straight boat-centred z axis (±200 m
 * window, side × 8..16 m x offset). That doesn't map onto a curvy OSM
 * route, so the port parametrises by progress `t ∈ [0, 1]` along the
 * curve instead, offsets perpendicular to the tangent by the same 8-16 m
 * band, and scales the per-profile count by the profile's
 * `groundCover.density` the same way React does (`reedCount =
 * REED_MAX * densityScale`, `rockCount = ROCK_MAX * densityScale`).
 *
 * Both layers return the existing `FoliageTree` shape with the new
 * species indices 3 (reed) and 4 (rock). `batchFoliagePools` bins them
 * into pools the engine's solid-flora stage already knows how to render,
 * so no new pool kind is needed; `floraSolidPool.buildFloraSolidMesh`
 * switches on `speciesIndex` for the geometry, and
 * `passes/floraSolid.wgsl` has size-5 palette arrays for the colour.
 */

import type { RouteCurve } from '../renderer/math/curve';
import type { FoliageTree } from './foliagePlan';
import { SCENERY_PROFILES } from '../../components/rower3d/sceneryConfig';
import { getSegmentSceneryProfile } from '../../components/rower3d/segmentScenery';
import type { SceneryTrack } from '../../components/rower3d/sceneryTrack';
import {
  getWaterEdgesSceneUnitsForProgress,
  type RouteEnrichmentData,
  type SceneryProfile,
} from '../services/routeEnrichmentService';
import { seededRandom } from './seededRandom';
import { SCENERY_WATER_MARGIN_METRES } from './foliagePlan';

/** Species indices the solid flora stage recognises for the new layers. */
export const REED_SPECIES = 3;
export const ROCK_SPECIES = 4;

/** React caps from `vegetationComponents.tsx`. Density scales each one. */
export const REED_MAX = 120;
export const ROCK_MAX = 40;

/** Half-width of the x-band the props sit in, metres from the near bank. */
const PROP_BAND_INNER = 2;
const PROP_BAND_OUTER = 10;

export interface ReedRockLayoutInput {
  curve: RouteCurve | null;
  enrichment?: RouteEnrichmentData | null;
  track?: SceneryTrack | null;
}

const sideOf = (offset: number): 'left' | 'right' => (offset < 0 ? 'left' : 'right');

const waterHalfWidthAt = (
  enrichment: RouteEnrichmentData | null | undefined,
  progress: number,
  side: 'left' | 'right',
): number => {
  const fallback = enrichment?.waterWidthMeters ?? 20;
  return getWaterEdgesSceneUnitsForProgress(enrichment?.segmentProfiles, fallback, progress)[side];
};

const placeOne = (
  curve: RouteCurve,
  length: number,
  enrichment: RouteEnrichmentData | null | undefined,
  track: SceneryTrack | null,
  index: number,
  species: number,
  salt: number,
): FoliageTree | null => {
  const seed = index * 17 + salt;
  const draw = (k: number): number => seededRandom(seed * 13 + k);
  const t = draw(1);
  const sign = draw(2) > 0.5 ? 1 : -1;
  const rawProfile = getSegmentSceneryProfile(enrichment, t, track, sideOf(sign));
  const profile: SceneryProfile = SCENERY_PROFILES[rawProfile] ? rawProfile : 'fallback';
  const density = SCENERY_PROFILES[profile].groundCover.density;
  // Thinning per profile: a biome whose groundCover.density is low plants
  // fewer props. Mirrors React's `densityScale` multiplier but applied as a
  // per-instance roll so the sprinkle thins instead of a hard cap.
  if (draw(3) > density) return null;
  const sample = curve.sample(Math.min(0.999, t));
  const px = -sample.tangent[2];
  const pz = sample.tangent[0];
  const perpLen = Math.hypot(px, pz) || 1;
  const perpX = px / perpLen;
  const perpZ = pz / perpLen;
  const halfWidth = waterHalfWidthAt(enrichment, t, sideOf(sign));
  const near = halfWidth + SCENERY_WATER_MARGIN_METRES + PROP_BAND_INNER;
  const far = near + (PROP_BAND_OUTER - PROP_BAND_INNER);
  const offset = near + draw(4) * (far - near);
  const x = sample.position[0] + perpX * sign * offset;
  const z = sample.position[2] + perpZ * sign * offset;
  const sway = Math.PI * 2 * draw(5);
  // length is unused in the position math but kept in the signature so
  // callers can log/debug how spread the layout went.
  void length;
  return {
    position: [x, 0, z],
    progress: t,
    species,
    height: 1,
    yaw: sway,
  };
};

export const layoutReeds = ({
  curve,
  enrichment = null,
  track = null,
}: ReedRockLayoutInput): FoliageTree[] => {
  if (!curve) return [];
  const length = curve.approximateLength(128);
  if (!(length > 0)) return [];
  const out: FoliageTree[] = [];
  for (let i = 0; i < REED_MAX; i += 1) {
    const tree = placeOne(curve, length, enrichment, track, i, REED_SPECIES, 101);
    if (tree) out.push(tree);
  }
  return out;
};

export const layoutRocks = ({
  curve,
  enrichment = null,
  track = null,
}: ReedRockLayoutInput): FoliageTree[] => {
  if (!curve) return [];
  const length = curve.approximateLength(128);
  if (!(length > 0)) return [];
  const out: FoliageTree[] = [];
  for (let i = 0; i < ROCK_MAX; i += 1) {
    const tree = placeOne(curve, length, enrichment, track, i, ROCK_SPECIES, 211);
    if (tree) out.push(tree);
  }
  return out;
};
