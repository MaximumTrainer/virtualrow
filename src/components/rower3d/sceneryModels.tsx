// ============================================================================
// SCENERY MODELS — places the llm-cad GLB kit (issue #216) along a route.
//
// Reads the same enrichment enums the procedural scenery uses
// (segment SceneryProfile + route WaterBodyType), asks sceneryAssets for the
// matching model set, loads those GLBs once (drei caches by URL) and scatters
// cloned instances out from the water: surface dressing on the water, bank
// edges at the waterline, ground scatter and trees on the bank, landform and
// backdrop masses behind.
//
// Two placement modes:
//   • curve mode (real routes) — samples the route curve exactly like
//     CurvedLandscapeElements: point + perpendicular + per-segment profile.
//   • straight mode (flat/default path) — fixed bands per bank.
//
// Models are authored in millimetres, Z-up, +Y facing the water; the GLB root
// node already rotates Z-up -> glTF Y-up, so here we only scale mm -> scene
// units and yaw each instance to sit with the existing landscape.
// ============================================================================
import React, { useMemo } from 'react';
import * as THREE from 'three';
import { useGLTF } from '@react-three/drei';
import type { RouteTheme } from './themeConfig';
import type { PerformanceMode } from './constants';
import { seededRandom } from './helpers';
import { getSegmentSceneryProfile } from './segmentScenery';
import {
  buildTerrainProfile,
  getTerrainReliefForProgress,
  type RouteEnrichmentData,
  type SceneryProfile,
} from '../../services/routeEnrichmentService';
import { SCENERY_PROFILES } from './sceneryConfig';
import {
  resolveSceneryModels,
  collectSceneryPaths,
  sceneryAssetPath,
  isGlbSceneryEnabled,
  type ResolvedScenery,
  type SceneryModelId,
} from './sceneryAssets';

// mm -> scene units. The curve scene sizes trees ~8 units and buildings ~12;
// this puts a ~22 m tree at ~9 units and a 30 m boathouse at ~12, in scale
// with the procedural landscape it sits amongst.
const ASSET_SCALE = 0.0004;

type Category = keyof ResolvedScenery;

/** Perpendicular offset (scene units from the water centreline) per category. */
const CATEGORY_OFFSET: Record<Category, [number, number]> = {
  surface: [0, 2.5],
  inWater: [0, 2],
  bankEdge: [2.5, 4.5],
  furniture: [3, 6],
  scatter: [6, 14],
  trees: [16, 44],
  landform: [46, 60],
  backdrop: [78, 95],
};

/** Whether a category should yaw to face the water, and its vertical seat. */
const CATEGORY_FACE: Record<Category, boolean> = {
  surface: false, inWater: false, bankEdge: true, furniture: true, scatter: false,
  trees: false, landform: true, backdrop: true,
};

interface Placement {
  id: SceneryModelId;
  position: [number, number, number];
  rotationY: number;
  scale: number;
  progress: number; // 0..1 along route, for visibility culling in curve mode
}

const pick = (ids: SceneryModelId[], seed: number): SceneryModelId | null =>
  ids.length === 0 ? null : ids[Math.floor(seededRandom(seed) * ids.length)];

const budgetFor = (mode: PerformanceMode): number =>
  mode === 'high' ? 1 : mode === 'low' ? 0.4 : 0.7;

// Rotation of categories placed as we walk the bank, one per sample per side.
const SCHEDULE: Category[] = [
  'bankEdge', 'scatter', 'trees', 'scatter', 'bankEdge', 'trees', 'surface', 'scatter',
];

interface SceneryModelsProps {
  side?: 'left' | 'right';
  boatZ?: number;
  boatProgress?: number;
  theme?: RouteTheme;
  enrichment?: RouteEnrichmentData | null;
  terrainY?: number;
  performanceMode?: PerformanceMode;
  /** When provided, place along this route curve (real routes). */
  curve?: THREE.Curve<THREE.Vector3> | null;
}

const distinctProfiles = (enrichment?: RouteEnrichmentData | null): SceneryProfile[] => {
  const set = new Set<SceneryProfile>();
  for (const s of enrichment?.segmentProfiles ?? []) set.add(s.sceneryProfile);
  if (set.size === 0) set.add('fallback');
  return Array.from(set);
};

/**
 * Must be rendered inside a <Suspense> boundary: it loads GLBs and will suspend
 * until they arrive.
 */
export const SceneryModels: React.FC<SceneryModelsProps> = ({
  side = 'left',
  boatZ = 0,
  boatProgress = 0,
  enrichment,
  terrainY = 0,
  performanceMode = 'high',
  curve = null,
}) => {
  const waterType = enrichment?.waterBodyType ?? 'unknown';

  // Resolve a model set per scenery profile that appears on the route, so the
  // per-segment profile can pick from an already-loaded set.
  const resolvedByProfile = useMemo(() => {
    const map = new Map<SceneryProfile, ResolvedScenery>();
    for (const p of distinctProfiles(enrichment)) {
      map.set(p, resolveSceneryModels(p, waterType, SCENERY_PROFILES[p]?.trees.species ?? []));
    }
    return map;
  }, [enrichment, waterType]);

  // Union of every GLB the route can show — loaded once, shared across instances.
  const paths = useMemo(() => {
    const all = new Set<string>();
    for (const r of resolvedByProfile.values()) collectSceneryPaths(r).forEach((p) => all.add(p));
    return Array.from(all);
  }, [resolvedByProfile]);

  const gltfs = useGLTF(paths) as unknown as Array<{ scene: THREE.Group }>;
  const sceneById = useMemo(() => {
    const map = new Map<SceneryModelId, THREE.Group>();
    paths.forEach((path, i) => {
      const id = path.split('/').pop()!.replace('.glb', '');
      const g = gltfs[i]?.scene;
      if (g) map.set(id, g);
    });
    return map;
  }, [paths, gltfs]);

  const budget = budgetFor(performanceMode);

  const placements = useMemo<Placement[]>(() => {
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
      // Kept deliberately sparse: these GLBs are un-decimated and sit on top of
      // an already heavy post-processed scene, so over-placing them can exhaust
      // the WebGL context.  One primary model per sample per side, with sparse
      // trees/landform/surface accents.
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
  }, [curve, enrichment, resolvedByProfile, budget, side]);

  const instances = useMemo(
    () =>
      placements
        .map((p, i) => {
          const src = sceneById.get(p.id);
          if (!src) return null;
          return { key: `${i}-${p.id}`, obj: src.clone(true), p };
        })
        .filter((v): v is { key: string; obj: THREE.Group; p: Placement } => v !== null),
    [placements, sceneById],
  );

  // In curve mode, only render instances near the boat (cheap per-frame filter,
  // no re-clone), matching CurvedLandscapeElements' visibility window.
  const visible = curve
    ? instances.filter(({ p }) => Math.abs(p.progress - boatProgress) < 0.12 || p.progress < 0.06)
    : instances;

  const groupPos: [number, number, number] = curve ? [0, 0, 0] : [0, terrainY, boatZ];

  return (
    <group position={groupPos}>
      {visible.map(({ key, obj, p }) => (
        <group key={key} position={p.position} rotation={[0, p.rotationY, 0]} scale={p.scale}>
          <primitive object={obj} />
        </group>
      ))}
    </group>
  );
};

// Keep the unused import referenced for future direct-path use.
void sceneryAssetPath;

// Warm the cache for the common default so the first route does not pop in —
// only when the kit is actually enabled, so it costs nothing when off.
if (isGlbSceneryEnabled()) {
  collectSceneryPaths(
    resolveSceneryModels('fallback', 'unknown', ['pine', 'oak', 'willow']),
  ).forEach((p) => useGLTF.preload(p));
}
