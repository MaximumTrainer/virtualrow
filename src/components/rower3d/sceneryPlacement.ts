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
import { trackProfiles, type SceneryTrack } from './sceneryTrack';
import {
  buildTerrainProfile,
  getTerrainReliefForProgress,
  type RouteEnrichmentData,
  type SceneryProfile,
} from '../../services/routeEnrichmentService';
import type { ResolvedScenery, SceneryModelId } from './sceneryAssets';
import { nearestBankOffset, waterHalfWidthAt } from './sceneryClearance';

/**
 * mm -> metres. A 22 000 mm tree is 22 units tall (#321).
 *
 * It was 0.0004, which put that tree at 8.8 units beside an 8-unit boat - which
 * is why the trees read as boat-sized and the boathouses looked like sheds.
 */
export const ASSET_SCALE = 0.001;

export type Category = keyof ResolvedScenery;

/**
 * Perpendicular offset in metres from the water centreline, per category.
 *
 * Scaled up by two and a half from the bands the scenery kit was authored
 * against, which ran at roughly 1 unit = 2.5 m (#321). Each band keeps the
 * place it held relative to the others, so the bank still reads bank, scatter,
 * trees, buildings, landform, backdrop - it is now that far out in metres.
 *
 * These are the bands as authored, for a narrow channel. What a placement uses
 * is `bandsClearOf` the water it stands beside, which pushes the bank bands
 * out wherever the water is wider than they allow for (#379).
 */
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

/**
 * The categories that stand on the bank, innermost authored band first.
 *
 * `surface` and `inWater` are not here: they are dressing for the water
 * itself, and keep their authored bands however wide it is (#379).
 */
export const LAND_BANDS: readonly Category[] = [
  'bankEdge', 'furniture', 'scatter', 'trees', 'buildings', 'landform', 'backdrop',
];

/**
 * The least a pushed band starts beyond the band inside it.
 *
 * Without it, water wide enough to push every band would line them all up on
 * the same metre of bank: the bank edge, the scatter and the buildings all
 * beginning at the waterline, which is the pile-up #379's R5 rules out.
 */
const MIN_BAND_STEP_METRES = 1;

/**
 * Each category's band for water of the given half-width (#379).
 *
 * Walked from the water outwards. A band starts no nearer than the waterline
 * plus the margin, and no nearer than a step beyond the band inside it; if
 * that means moving, it moves out whole, keeping its authored depth, rather
 * than being squashed against the bank. A band already clear of both stays
 * where it was authored, so the push stops at the first band with room - on a
 * narrow channel only the bank edge moves, and on a wide one the whole
 * arrangement goes out together, still in order.
 */
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

/** Whether a category's placements stand on the water or on the bank. */
const footingOf = (cat: Category): Footing =>
  cat === 'surface' || cat === 'inWater' ? 'water' : 'bank';

/** Whether a category should yaw to face the water. */
export const CATEGORY_FACE: Record<Category, boolean> = {
  surface: false, inWater: false, bankEdge: true, furniture: true, scatter: false,
  trees: false, landform: true, backdrop: true, buildings: true,
};

/** Categories placed as we walk the bank, one per sample per side. */
export const SCHEDULE: Category[] = [
  'bankEdge', 'scatter', 'trees', 'scatter', 'bankEdge', 'trees', 'surface', 'scatter',
];

/**
 * What a placement stands on. Dressing on the water and a bridge across it are
 * placed there on purpose; everything else must be on the bank (#379).
 */
export type Footing = 'bank' | 'water';

export interface Placement {
  id: SceneryModelId;
  position: [number, number, number];
  rotationY: number;
  scale: number;
  /** 0..1 along the route, for visibility culling in curve mode. */
  progress: number;
  footing: Footing;
}

/**
 * Most instances a single bank may contribute.
 *
 * The comment here used to say this stopped cost scaling with route length. It
 * never did: the sample count is `Math.max(6, Math.round(22 * budget))`,
 * independent of how long the route is, so a 20 km course is sampled at the
 * same 23 bands as a 2 km one and simply dressed more thinly on the ground.
 * What actually bounds a bank is that band count — a few hundred instances at
 * the very most — and this ceiling has never been reached (review of #232).
 *
 * It is kept as a backstop, because the band count is the kind of number that
 * gets raised, and the #224 budgets (p95 frame 18 ms, 80 MB of geometry) should
 * not depend on nobody having done so. The name is accurate now that each call
 * returns one bank rather than both.
 */
export const MAX_INSTANCES_PER_SIDE = 900;

/** Bands sampled along the route at full budget; the real bound on a bank. */
export const MAX_SAMPLE_BANDS = 22;

/**
 * Thin a set of placements to the ceiling by stride rather than truncation, so
 * the whole route stays dressed instead of the last kilometres running bare.
 */
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

/** Pick a model id from a category list deterministically, or null if empty. */
export const pick = (ids: SceneryModelId[], seed: number): SceneryModelId | null =>
  ids.length === 0 ? null : ids[Math.floor(seededRandom(seed) * ids.length)];

/** Instance-count multiplier for the performance mode. */
export const budgetFor = (mode: PerformanceMode): number =>
  mode === 'high' ? 1 : mode === 'low' ? 0.4 : 0.7;

/** Distinct scenery profiles present on the route (fallback when none). */
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
  curve?: THREE.Curve<THREE.Vector3> | null;
  enrichment?: RouteEnrichmentData | null;
  resolvedByProfile: Map<SceneryProfile, ResolvedScenery>;
  budget: number;
  side: 'left' | 'right';
  /** Authored dressing, preferred over enrichment when the route has one (#232). */
  track?: SceneryTrack | null;
}

/**
 * Compute every scenery instance for a route. Curve mode samples the route curve
 * (per-segment profile, perpendicular offsets); flat mode lays fixed bands per
 * bank. Pure — no R3F, no GLB loading.
 */
export const computePlacements = (input: PlacementInput): Placement[] => {
  const { curve, enrichment, resolvedByProfile, budget, side, track = null } = input;
  const out: Placement[] = [];
  const firstResolved = resolvedByProfile.values().next().value as ResolvedScenery | undefined;
  const fallback = resolvedByProfile.get('fallback') ?? firstResolved;

  /** Same shape as `place`, and deliberately does nothing. */
  const noPlace = (..._args: Parameters<typeof place>) => {};

  const place = (
    cat: Category, sign: number, t: number,
    px: number, pz: number, perpX: number, perpZ: number, py: number,
    baseRot: number, seed: number, resolved: ResolvedScenery,
  ) => {
    const id = pick(resolved[cat] as SceneryModelId[], seed);
    if (!id) return;
    // Measured from the water this point actually has, not the narrow channel
    // the bands were authored against (#379).
    const [oMin, oMax] = bandsClearOf(waterHalfWidthAt(enrichment, t))[cat];
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
    // Kept deliberately sparse: these GLBs are un-decimated and sit on top of an
    // already heavy scene, so over-placing them can exhaust the WebGL context.
    const terrain = buildTerrainProfile(enrichment?.elevations);
    const wantSign = side === 'left' ? -1 : 1;
    const up = new THREE.Vector3(0, 1, 0);
    const stepCount = Math.max(6, Math.round(MAX_SAMPLE_BANDS * budget));
    let seed = 100;
    for (let i = 0; i <= stepCount; i++) {
      const t = i / stepCount;
      const point = curve.getPointAt(Math.min(0.999, t));
      const tangent = curve.getTangentAt(Math.min(0.999, t)).normalize();
      const perp = new THREE.Vector3().crossVectors(tangent, up).normalize();
      const profile = getSegmentSceneryProfile(enrichment, t, track);
      const resolved = resolvedByProfile.get(profile) ?? fallback;
      if (!resolved) continue;
      const y = getTerrainReliefForProgress(terrain, t);
      const baseRot = Math.atan2(tangent.x, tangent.z);
      for (const sign of [-1, 1]) {
        // Both signs are walked so the seed stream is unchanged and each bank
        // keeps the exact dressing it had, but only the bank this call was
        // asked for is emitted. The loop used to ignore `side` entirely, so the
        // left and right components each returned both banks and every object
        // was drawn twice at the same transform (review of #232).
        const put = sign === wantSign ? place : noPlace;
        seed += 5;
        const cat = SCHEDULE[(i + (sign < 0 ? 0 : 4)) % SCHEDULE.length];
        put(cat, sign, t, point.x, point.z, perp.x, perp.z, y, baseRot, seed, resolved);
        if (i % 3 === 0) { seed += 5; put('trees', sign, t, point.x, point.z, perp.x, perp.z, y, baseRot, seed, resolved); }
        if (i % 6 === 0) { seed += 5; put('surface', sign, t, point.x, point.z, perp.x, perp.z, y, baseRot, seed, resolved); }
        if (i % 8 === 0 && sign < 0) { seed += 5; put('landform', sign, t, point.x, point.z, perp.x, perp.z, y, baseRot, seed, resolved); }
        if (i % 12 === 0 && sign > 0) { seed += 5; put('backdrop', sign, t, point.x, point.z, perp.x, perp.z, y, baseRot, seed, resolved); }
        if (i % 5 === 0) { seed += 5; put('furniture', sign, t, point.x, point.z, perp.x, perp.z, y, baseRot, seed, resolved); }
        // Buildings only appear where the profile is built-up and the region has
        // a kit; pick() returns null otherwise, so wild stretches cost nothing.
        if (i % 4 === 0) { seed += 5; put('buildings', sign, t, point.x, point.z, perp.x, perp.z, y, baseRot, seed, resolved); }
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
  return thinToCeiling(out);
};
