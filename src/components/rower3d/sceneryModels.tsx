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
import {
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
import { trackWaterForProfile, type SceneryTrack } from './sceneryTrack';
import type { SceneryRegion } from './sceneryRegion';
import {
  budgetFor,
  distinctProfiles,
  computePlacements,
  type Placement,
} from './sceneryPlacement';

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
  /** Authored dressing for a route that states its own progression (#232). */
  track?: SceneryTrack | null;
  /** Regional building kit for the route's geography (#232). */
  region?: SceneryRegion | null;
}

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
  track = null,
  region = null,
}) => {
  const waterType = enrichment?.waterBodyType ?? 'unknown';

  // Resolve a model set per scenery profile that appears on the route, so the
  // per-segment profile can pick from an already-loaded set.
  const resolvedByProfile = useMemo(() => {
    const map = new Map<SceneryProfile, ResolvedScenery>();
    for (const p of distinctProfiles(enrichment, track)) {
      // An authored band carries its own water body, so the delta resolves as a
      // lake while the rest of the same route stays a river.
      const water = track ? trackWaterForProfile(track, p) : waterType;
      map.set(p, resolveSceneryModels(p, water, SCENERY_PROFILES[p]?.trees.species ?? [], region));
    }
    return map;
  }, [enrichment, waterType, track, region]);

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

  const placements = useMemo<Placement[]>(
    () => computePlacements({ curve, enrichment, resolvedByProfile, budget, side, track }),
    [curve, enrichment, resolvedByProfile, budget, side, track],
  );

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
