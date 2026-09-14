// ============================================================================
// SCENERY PLACEMENT — pure layout logic for the GLB scenery kit.
//
// Split out of sceneryModels.tsx so the placement maths (which category goes
// where, at what offset/rotation/scale, along a curve or in flat bands) is
// testable without the R3F scene or GLB loading.
// ============================================================================
import * as THREE from 'three';
import type { PerformanceMode } from './constants';
import { seededRandom } from './helpers';
import { getSegmentSceneryProfile } from './segmentScenery';
import {
  buildTerrainProfile,
  getTerrainReliefForProgress,
  type RouteEnrichmentData,
  type SceneryProfile,
} from '../../services/routeEnrichmentService';
import type { ResolvedScenery, SceneryModelId } from './sceneryAssets';

/** mm -> scene units; puts a ~22 m tree at ~9 units, a 30 m boathouse at ~12. */
export const ASSET_SCALE = 0.0004;

export type Category = keyof ResolvedScenery;

/** Perpendicular offset (scene units from the water centreline) per category. */
export const CATEGORY_OFFSET: Record<Category, [number, number]> = {
  surface: [0, 2.5],
  inWater: [0, 2],
  bankEdge: [2.5, 4.5],
  furniture: [3, 6],
  scatter: [6, 14],
  trees: [16, 44],
  landform: [46, 60],
  backdrop: [78, 95],
};

/** Whether a category should yaw to face the water. */
export const CATEGORY_FACE: Record<Category, boolean> = {
  surface: false, inWater: false, bankEdge: true, furniture: true, scatter: false,
  trees: false, landform: true, backdrop: true,
};

/** Categories placed as we walk the bank, one per sample per side. */
export const SCHEDULE: Category[] = [
  'bankEdge', 'scatter', 'trees', 'scatter', 'bankEdge', 'trees', 'surface', 'scatter',
];

export interface Placement {
  id: SceneryModelId;
  position: [number, number, number];
  rotationY: number;
  scale: number;
  /** 0..1 along the route, for visibility culling in curve mode. */
  progress: number;
}

/** Pick a model id from a category list deterministically, or null if empty. */
export const pick = (ids: SceneryModelId[], seed: number): SceneryModelId | null =>
  ids.length === 0 ? null : ids[Math.floor(seededRandom(seed) * ids.length)];

/** Instance-count multiplier for the performance mode. */
export const budgetFor = (mode: PerformanceMode): number =>
  mode === 'high' ? 1 : mode === 'low' ? 0.4 : 0.7;

/** Distinct scenery profiles present on the route (fallback when none). */
export const distinctProfiles = (enrichment?: RouteEnrichmentData | null): SceneryProfile[] => {
  const set = new Set<SceneryProfile>();
  for (const s of enrichment?.segmentProfiles ?? []) set.add(s.sceneryProfile);
  if (set.size === 0) set.add('fallback');
  return Array.from(set);
};

export interface PlacementInput {
  curve?: THREE.Curve<THREE.Vector3> | null;
  enrichment?: RouteEnrichmentData | null;
  resolvedByProfile: Map<SceneryProfile, ResolvedScenery>;
  budget: number;
  side: 'left' | 'right';
}

/**
 * Compute every scenery instance for a route. Curve mode samples the route curve
 * (per-segment profile, perpendicular offsets); flat mode lays fixed bands per
 * bank. Pure — no R3F, no GLB loading.
 */
export const computePlacements = (input: PlacementInput): Placement[] => {
  const { curve, enrichment, resolvedByProfile, budget, side } = input;
  const out: Placement[] = [];
  const firstResolved = resolvedByProfile.values().next().value as ResolvedScenery | undefined;
  const fallback = resolvedByProfile.get('fallback') ?? firstResolved;

  const place = (
    cat: Category, sign: number, t: number,
    px: number, pz: number, perpX: number, perpZ: number, py: number,
    baseRot: number, seed: number, resolved: ResolvedScenery,
  ) => {
    const id = pick(resolved[cat] as SceneryModelId[], seed);
    if (!id) return;
    const [oMin, oMax] = CATEGORY_OFFSET[cat];
    const offset = sign * (oMin + seededRandom(seed + 1) * (oMax - oMin));
    const x = px + perpX * offset;
    const z = pz + perpZ * offset;
    const y = cat === 'surface' ? 0.15 : py;
    const faceWater = sign < 0 ? Math.PI / 2 : -Math.PI / 2;
    const rotationY = CATEGORY_FACE[cat]
      ? baseRot + faceWater + (seededRandom(seed + 2) - 0.5) * 0.4
      : seededRandom(seed + 2) * Math.PI * 2;
    const scale = ASSET_SCALE * (0.8 + seededRandom(seed + 3) * 0.5);
    out.push({ id, position: [x, y, z], rotationY, scale, progress: t });
  };

  if (curve) {
    // Kept deliberately sparse: these GLBs are un-decimated and sit on top of an
    // already heavy scene, so over-placing them can exhaust the WebGL context.
    const terrain = buildTerrainProfile(enrichment?.elevations);
    const up = new THREE.Vector3(0, 1, 0);
    const stepCount = Math.max(6, Math.round(22 * budget));
    let seed = 100;
    for (let i = 0; i <= stepCount; i++) {
      const t = i / stepCount;
      const point = curve.getPointAt(Math.min(0.999, t));
      const tangent = curve.getTangentAt(Math.min(0.999, t)).normalize();
      const perp = new THREE.Vector3().crossVectors(tangent, up).normalize();
      const profile = getSegmentSceneryProfile(enrichment, t);
      const resolved = resolvedByProfile.get(profile) ?? fallback;
      if (!resolved) continue;
      const y = getTerrainReliefForProgress(terrain, t);
      const baseRot = Math.atan2(tangent.x, tangent.z);
      for (const sign of [-1, 1]) {
        seed += 5;
        const cat = SCHEDULE[(i + (sign < 0 ? 0 : 4)) % SCHEDULE.length];
        place(cat, sign, t, point.x, point.z, perp.x, perp.z, y, baseRot, seed, resolved);
        if (i % 3 === 0) { seed += 5; place('trees', sign, t, point.x, point.z, perp.x, perp.z, y, baseRot, seed, resolved); }
        if (i % 6 === 0) { seed += 5; place('surface', sign, t, point.x, point.z, perp.x, perp.z, y, baseRot, seed, resolved); }
        if (i % 8 === 0 && sign < 0) { seed += 5; place('landform', sign, t, point.x, point.z, perp.x, perp.z, y, baseRot, seed, resolved); }
        if (i % 12 === 0 && sign > 0) { seed += 5; place('backdrop', sign, t, point.x, point.z, perp.x, perp.z, y, baseRot, seed, resolved); }
        if (i % 5 === 0) { seed += 5; place('furniture', sign, t, point.x, point.z, perp.x, perp.z, y, baseRot, seed, resolved); }
      }
    }
  } else if (fallback) {
    // Straight/flat path: fixed bands per bank along z, water at x=0, perp=+x.
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
  return out;
};
