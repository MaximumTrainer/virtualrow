/**
 * Three-free port of `src/components/rower3d/landscapeLayout.ts` (#333's
 * procedural landscape). Walks the route at 2 % increments and rolls each
 * slot as a `building`, `tree` or `mountain`:
 *   - buildings and mountains stand on either bank at a seeded offset past
 *     the nearest navigable waterline + a density-driven stand-off,
 *   - trees are slots left for `foliagePlan` to plant (so a bank with high
 *     tree density stays dense in foliage without this layer duplicating
 *     tree placements).
 *
 * The output structurally matches the React `LandscapeLayout`, with
 * `position` flattened from `THREE.Vector3` to `[x, y, z]` tuples at the
 * `src/lib/renderer/math/vec3` boundary. The React originals use `three`
 * only for `Vector3`/curve math; the port samples the engine's `RouteCurve`
 * through the same tangent/perp construction `waterStrip` already uses.
 */

import type { RouteCurve } from '../renderer/math/curve';
import { vec3 } from '../renderer/math/vec3';
import type { BuildingSpec } from '../renderer/plan/buildings';
import { seededRandom } from './seededRandom';
import { getSegmentSceneryProfile } from '../../components/rower3d/segmentScenery';
import type { SceneryTrack } from '../../components/rower3d/sceneryTrack';
import {
  buildTerrainProfile,
  getTerrainReliefForProgress,
  SCENERY_PROFILE_CONFIG,
  type RouteEnrichmentData,
  type RouteSegmentEnrichment,
  type SceneryProfile,
} from '../services/routeEnrichmentService';

export const LANDSCAPE_OFFSET = 50;
export const SCENERY_WATER_MARGIN_METRES = 2;

export type LandscapeElementType = 'mountain' | 'building';
export type BankSide = 'left' | 'right';

export interface LandscapeElement {
  position: [number, number, number];
  type: LandscapeElementType;
  scale: number;
  rotation: number;
  sceneryProfile: SceneryProfile;
  progress: number;
  side: BankSide;
}

export interface LandscapeLayout {
  leftElements: LandscapeElement[];
  rightElements: LandscapeElement[];
}

export interface LandscapeLayoutInput {
  curve: RouteCurve | null;
  enrichment?: RouteEnrichmentData | null;
  track?: SceneryTrack | null;
}

const DEFAULT_WATER_WIDTH_METERS = 20;
const nearestBankOffset = (halfWidth: number): number => halfWidth + SCENERY_WATER_MARGIN_METRES;

// Mirror of the water-edges helper in the enrichment service, without pulling
// SCENE_SCALE and the clearance module (which uses three).
const waterHalfWidthAt = (
  enrichment: RouteEnrichmentData | null | undefined,
  progress: number,
  side: BankSide,
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

const densitiesOf = (segment: RouteSegmentEnrichment, side: BankSide) => {
  const own = side === 'left' ? segment.leftSceneryProfile : segment.rightSceneryProfile;
  return own ? SCENERY_PROFILE_CONFIG[own] : segment;
};

type SegmentStyle = {
  treeDensity: number;
  vegetationDensity: number;
  buildingDensity: number;
  objectScale: number;
};

const getSegmentStyle = (
  enrichment: RouteEnrichmentData | null | undefined,
  progress: number,
  side: BankSide,
): SegmentStyle => {
  const profiles = enrichment?.segmentProfiles;
  if (!profiles || profiles.length === 0) {
    return { treeDensity: 0.45, vegetationDensity: 0.5, buildingDensity: 0.12, objectScale: 1 };
  }
  const clamped = Math.max(0, Math.min(1, progress));
  const lastIndex = profiles.length - 1;
  const scaled = clamped * lastIndex;
  const lowerIndex = Math.floor(scaled);
  const upperIndex = Math.min(lastIndex, lowerIndex + 1);
  const blend = scaled - lowerIndex;
  const lower = densitiesOf(profiles[lowerIndex], side);
  const upper = densitiesOf(profiles[upperIndex], side);
  return {
    treeDensity: lower.treeDensity + (upper.treeDensity - lower.treeDensity) * blend,
    vegetationDensity: lower.vegetationDensity + (upper.vegetationDensity - lower.vegetationDensity) * blend,
    buildingDensity: lower.buildingDensity + (upper.buildingDensity - lower.buildingDensity) * blend,
    objectScale: lower.objectScale + (upper.objectScale - lower.objectScale) * blend,
  };
};

type SlotRoll = LandscapeElementType | 'tree';

const rollSlot = (style: SegmentStyle, elemIdx: number, seedOffset: number): SlotRoll => {
  const rand = seededRandom(elemIdx * 7 + seedOffset);
  const buildingThreshold = Math.min(0.8, style.buildingDensity * 0.85);
  const treeThreshold = Math.min(
    0.98,
    buildingThreshold + Math.max(0.18, style.treeDensity * 0.75),
  );
  if (rand < buildingThreshold) return 'building';
  if (rand < treeThreshold) return 'tree';
  return 'mountain';
};

const placementChance = (style: SegmentStyle): number =>
  0.1 + style.treeDensity * 0.55 + style.vegetationDensity * 0.2;

export const layoutLandscape = ({
  curve,
  enrichment,
  track = null,
}: LandscapeLayoutInput): LandscapeLayout => {
  if (!curve) return { leftElements: [], rightElements: [] };

  const leftElements: LandscapeElement[] = [];
  const rightElements: LandscapeElement[] = [];

  const elementSpacing = 0.02;
  const terrain = buildTerrainProfile(enrichment?.elevations);

  let elemIdx = 0;
  const sample = { position: vec3(), tangent: vec3(0, 0, -1), angle: 0 };

  for (let t = 0; t < 1; t += elementSpacing) {
    curve.sample(t, sample);
    // Left-hand perpendicular (tangent × up) — same construction as waterStrip.
    const perpX = -sample.tangent[2];
    const perpZ = sample.tangent[0];
    const perpLen = Math.hypot(perpX, perpZ) || 1;
    const px = perpX / perpLen;
    const pz = perpZ / perpLen;
    const tangentAngle = Math.atan2(sample.tangent[0], sample.tangent[2]);

    const bankLeft = {
      style: getSegmentStyle(enrichment, t, 'left'),
      sceneryProfile: getSegmentSceneryProfile(enrichment, t, track, 'left'),
      minOffset: Math.max(LANDSCAPE_OFFSET, nearestBankOffset(waterHalfWidthAt(enrichment, t, 'left'))),
    };
    const bankRight = {
      style: getSegmentStyle(enrichment, t, 'right'),
      sceneryProfile: getSegmentSceneryProfile(enrichment, t, track, 'right'),
      minOffset: Math.max(LANDSCAPE_OFFSET, nearestBankOffset(waterHalfWidthAt(enrichment, t, 'right'))),
    };

    const leftOffset =
      bankLeft.minOffset + seededRandom(elemIdx * 7 + 1) * (16 + (1 - bankLeft.style.vegetationDensity) * 34);
    const rightOffset =
      bankRight.minOffset + seededRandom(elemIdx * 7 + 2) * (16 + (1 - bankRight.style.vegetationDensity) * 34);

    const leftRoll = rollSlot(bankLeft.style, elemIdx, 3);
    if (seededRandom(elemIdx * 7 + 4) < placementChance(bankLeft.style) && leftRoll !== 'tree') {
      const x = sample.position[0] + px * -leftOffset;
      const z = sample.position[2] + pz * -leftOffset;
      leftElements.push({
        position: [x, getTerrainReliefForProgress(terrain, t), z],
        type: leftRoll,
        scale: (0.8 + seededRandom(elemIdx * 7 + 5) * 0.8) * bankLeft.style.objectScale,
        rotation: tangentAngle + Math.PI / 2,
        sceneryProfile: bankLeft.sceneryProfile,
        progress: t,
        side: 'left',
      });
    }

    const rightRoll = rollSlot(bankRight.style, elemIdx, 7);
    if (seededRandom(elemIdx * 7 + 6) < placementChance(bankRight.style) && rightRoll !== 'tree') {
      const x = sample.position[0] + px * rightOffset;
      const z = sample.position[2] + pz * rightOffset;
      rightElements.push({
        position: [x, getTerrainReliefForProgress(terrain, t), z],
        type: rightRoll,
        scale: (0.8 + seededRandom(elemIdx * 7 + 8) * 0.8) * bankRight.style.objectScale,
        rotation: tangentAngle - Math.PI / 2,
        sceneryProfile: bankRight.sceneryProfile,
        progress: t,
        side: 'right',
      });
    }

    elemIdx += 1;
  }

  return { leftElements, rightElements };
};

/**
 * Convert the facade `building` elements in a landscape layout to the engine's
 * `BuildingSpec` seam (axis-aligned prisms with per-footprint profile
 * palette). Mountains are left out — they have no engine pass as of this slice.
 *
 * Each facade is a rectangular box aligned to the route tangent at its slot.
 * The axis-aligned `BuildingSpec` can't rotate the footprint, so the
 * `halfWidth`/`halfDepth` here are the box's extents along world X and Z.
 * For a near-straight river that's good enough — the React facades are also
 * roughly tangent-aligned and get read as "houses in the distance".
 *
 * Baseline footprint 6 m × 8 m, height from `SCENERY_PROFILES[profile].
 * buildings.heightRange` applied over `BASE_BUILDING_HEIGHT = 12.5 m`.
 */
export const layoutToBuildingSpecs = (
  layout: LandscapeLayout,
  profilesConfig: Record<SceneryProfile, { buildings: { heightRange: [number, number] } }>,
): BuildingSpec[] => {
  const specs: BuildingSpec[] = [];
  const BASE_FOOT_W = 3;
  const BASE_FOOT_D = 4;
  const BASE_HEIGHT = 12.5;
  const toProfile = (p: SceneryProfile): BuildingSpec['profile'] => {
    switch (p) {
      case 'residential': return 'residential';
      case 'commercial': return 'commercial';
      case 'wetland':
      case 'beach':
      case 'farmland':
      case 'forest': return 'residential';
      default: return 'fallback';
    }
  };
  for (const side of [layout.leftElements, layout.rightElements]) {
    for (const el of side) {
      if (el.type !== 'building') continue;
      const [hMin, hMax] = profilesConfig[el.sceneryProfile]?.buildings.heightRange ?? [0.7, 1.0];
      const heightMul = hMin + (hMax - hMin) * ((seededRandom(Math.floor(el.progress * 10000)) + 1) / 2);
      specs.push({
        x: el.position[0],
        z: el.position[2],
        halfWidth: BASE_FOOT_W * el.scale,
        halfDepth: BASE_FOOT_D * el.scale,
        height: BASE_HEIGHT * heightMul,
        profile: toProfile(el.sceneryProfile),
      });
    }
  }
  return specs;
};
