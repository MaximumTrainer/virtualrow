// ============================================================================
// LANDSCAPE LAYOUT — where CurvedLandscapeElements puts its procedural
// buildings and mountains.
//
// Split out of bankComponents.tsx so the layout can be asserted without a
// WebGL context: that file is an R3F component and out of the unit coverage,
// which is how the landscape went on measuring from the centreline while the
// water beside it widened (#379).
//
// The trees it used to place here are planted by the metre in foliagePlan.ts
// now (#333). A slot that rolls a tree stays empty, so every house and
// mountain keeps the place it had.
// ============================================================================
import * as THREE from 'three';
import { LANDSCAPE_OFFSET } from './constants';
import { seededRandom } from './helpers';
import { getSegmentSceneryProfile } from './segmentScenery';
import type { SceneryTrack } from './sceneryTrack';
import { nearestBankOffset, waterHalfWidthAt, type BankSide } from './sceneryClearance';
import {
  buildTerrainProfile,
  getTerrainReliefForProgress,
  SCENERY_PROFILE_CONFIG,
  type RouteEnrichmentData,
  type RouteSegmentEnrichment,
  type SceneryProfile,
} from '../../lib/services/routeEnrichmentService';

export type LandscapeElementType = 'mountain' | 'building';

/** What a slot rolls: a tree is a slot left for the foliage. */
type SlotRoll = LandscapeElementType | 'tree';

export interface LandscapeElement {
  position: THREE.Vector3;
  type: LandscapeElementType;
  scale: number;
  rotation: number;
  sceneryProfile: SceneryProfile;
  /** 0..1 along the route, where the element was placed. */
  progress: number;
}

export interface LandscapeLayout {
  leftElements: LandscapeElement[];
  rightElements: LandscapeElement[];
}

/** A segment's densities, or the ones its bank's own land has (#493 FR18). */
const densitiesOf = (segment: RouteSegmentEnrichment, side: BankSide) => {
  const own = side === 'left' ? segment.leftSceneryProfile : segment.rightSceneryProfile;
  return own ? SCENERY_PROFILE_CONFIG[own] : segment;
};

type SegmentStyle = ReturnType<typeof getSegmentStyle>;

const getSegmentStyle = (
  enrichment: RouteEnrichmentData | null | undefined,
  progress: number,
  side: BankSide,
) => {
  const segmentProfiles = enrichment?.segmentProfiles;
  if (!segmentProfiles || segmentProfiles.length === 0) {
    return {
      treeDensity: 0.45,
      vegetationDensity: 0.5,
      buildingDensity: 0.12,
      objectScale: 1,
    };
  }

  const clampedProgress = Math.max(0, Math.min(1, progress));
  const lastIndex = segmentProfiles.length - 1;
  const scaledIndex = clampedProgress * lastIndex;
  const lowerIndex = Math.floor(scaledIndex);
  const upperIndex = Math.min(lastIndex, lowerIndex + 1);
  const blend = scaledIndex - lowerIndex;
  const lower = densitiesOf(segmentProfiles[lowerIndex], side);
  const upper = densitiesOf(segmentProfiles[upperIndex], side);

  return {
    treeDensity: lower.treeDensity + (upper.treeDensity - lower.treeDensity) * blend,
    vegetationDensity:
      lower.vegetationDensity +
      (upper.vegetationDensity - lower.vegetationDensity) * blend,
    buildingDensity:
      lower.buildingDensity + (upper.buildingDensity - lower.buildingDensity) * blend,
    objectScale: lower.objectScale + (upper.objectScale - lower.objectScale) * blend,
  };
};

export interface LandscapeLayoutInput {
  curve: THREE.Curve<THREE.Vector3> | null;
  enrichment?: RouteEnrichmentData | null;
  /** Authored dressing, preferred over enrichment when the route has one (#232). */
  track?: SceneryTrack | null;
}

/**
 * Lay out the procedural landscape along a route. Pure and deterministic.
 *
 * Each element stands a seeded distance beyond a floor. The floor was
 * `LANDSCAPE_OFFSET` alone, 50 m from the centreline, which is inside any
 * water wider than 100 m; it is now the further of that and the bank at this
 * point, so wide water moves the landscape out without squashing its spread
 * (#379).
 */
export const layoutLandscape = ({
  curve,
  enrichment,
  track = null,
}: LandscapeLayoutInput): LandscapeLayout => {
  if (!curve) return { leftElements: [], rightElements: [] };

  const leftElements: LandscapeElement[] = [];
  const rightElements: LandscapeElement[] = [];

  const elementSpacing = 0.02;
  // Same terrain the banks are built from, so trees and buildings stand on
  // the raised ground rather than being buried in it (#202).
  const terrain = buildTerrainProfile(enrichment?.elevations);

  let elemIdx = 0;
  for (let t = 0; t < 1; t += elementSpacing) {
    const point = curve.getPointAt(t);
    const tangent = curve.getTangentAt(t).normalize();
    const up = new THREE.Vector3(0, 1, 0);
    const perp = new THREE.Vector3().crossVectors(tangent, up).normalize();
    // Each bank its own land (#493 FR18) and measured from its own waterline (D19 c).
    const bank = (side: BankSide) => ({
      style: getSegmentStyle(enrichment, t, side),
      sceneryProfile: getSegmentSceneryProfile(enrichment, t, track, side),
      minOffset: Math.max(LANDSCAPE_OFFSET, nearestBankOffset(waterHalfWidthAt(enrichment, t, side))),
    });
    const left = bank('left');
    const right = bank('right');

    const leftOffset =
      left.minOffset + seededRandom(elemIdx * 7 + 1) * (16 + (1 - left.style.vegetationDensity) * 34);
    const rightOffset =
      right.minOffset + seededRandom(elemIdx * 7 + 2) * (16 + (1 - right.style.vegetationDensity) * 34);

    const rollSlot = (style: SegmentStyle, seedOffset: number): SlotRoll => {
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

    const placementChance = (style: SegmentStyle) =>
      0.1 + style.treeDensity * 0.55 + style.vegetationDensity * 0.2;
    const leftRoll = rollSlot(left.style, 3);
    if (seededRandom(elemIdx * 7 + 4) < placementChance(left.style) && leftRoll !== 'tree') {
      const leftPos = new THREE.Vector3().copy(point).addScaledVector(perp, -leftOffset);
      leftPos.y = getTerrainReliefForProgress(terrain, t);
      leftElements.push({
        position: leftPos,
        type: leftRoll,
        scale: (0.8 + seededRandom(elemIdx * 7 + 5) * 0.8) * left.style.objectScale,
        rotation: Math.atan2(tangent.x, tangent.z) + Math.PI / 2,
        sceneryProfile: left.sceneryProfile,
        progress: t,
      });
    }

    const rightRoll = rollSlot(right.style, 7);
    if (seededRandom(elemIdx * 7 + 6) < placementChance(right.style) && rightRoll !== 'tree') {
      const rightPos = new THREE.Vector3().copy(point).addScaledVector(perp, rightOffset);
      rightPos.y = getTerrainReliefForProgress(terrain, t);
      rightElements.push({
        position: rightPos,
        type: rightRoll,
        scale: (0.8 + seededRandom(elemIdx * 7 + 8) * 0.8) * right.style.objectScale,
        rotation: Math.atan2(tangent.x, tangent.z) - Math.PI / 2,
        sceneryProfile: right.sceneryProfile,
        progress: t,
      });
    }
    elemIdx++;
  }

  return { leftElements, rightElements };
};

/** Every element's position and progress, in the shape `landClearance` measures. */
export const landscapeStanding = ({ leftElements, rightElements }: LandscapeLayout) =>
  [...leftElements, ...rightElements].map(({ position, progress }) => ({
    position: [position.x, position.y, position.z] as const,
    progress,
  }));
