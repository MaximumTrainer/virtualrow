/**
 * Shell route → engine `SceneryRoute` adapter (#570 AC2, extended for #549).
 *
 * The `/row` screen hands the WebGPU engine a route through the `rideCanvas`
 * seam. The engine treats the route as `unknown` and only acts on it when it
 * is a `SceneryRoute` — an object with a `pools` array — reading `curvePoints`
 * (world-space points for the boat/ghost curve) and `totalDistanceMeters` (the
 * real route length it maps row distance onto). A plain `WaterRoute` has
 * neither, so without this adapter the engine falls back to a canned straight
 * line and the boat never follows the selected route.
 *
 * Beyond that minimum, this adapter forwards:
 *   - `isClosedLoop`: so a lap route wraps instead of showing a seam where
 *     the finish meets the start. Detection mirrors
 *     `src/components/rower3d/curve.ts`'s `isClosedLoop` (≥4 coords and the
 *     endpoints within 5 m).
 *   - `waterEdgesForProgress`: per-progress shore widths taken from the
 *     route's OSM enrichment via `getWaterEdgesSceneUnitsForProgress`, so
 *     the water strip bends and widens with the measured river rather than
 *     sitting as a symmetric ±20 m ribbon. Falls back to the enrichment's
 *     `waterWidthMeters` or the engine's default half-width when no
 *     enrichment is passed.
 *
 * Framework-free and intentionally not coupled to the engine's own types: the
 * seam passes the route as `unknown`, so the return shape mirrors the engine's
 * `SceneryRoute` structurally without importing from `src/lib/renderer`.
 *
 * `pools` is empty here: this slice wires the route curve the boat runs on, not
 * the scenery instancing (the engine mounts an empty scenery pass for an empty
 * `pools`, which is what it already does on the fallback route).
 */
import type { WaterRoute } from '../types/index';
import {
  getWaterEdgesSceneUnitsForProgress,
  type RouteEnrichmentData,
} from '../services/routeEnrichmentService';
import { distanceBetweenLatLng, latLngToMeters } from '../utils/geoUtils';
import type { OsmBuilding } from '../services/routeEnrichmentService';
import { SCENE_SCALE } from '../utils/worldScale';
import { routeCurvePoints } from '../utils/routeWorldCurve';
import { RouteCurve } from '../renderer/math/curve';
import { vec3 } from '../renderer/math/vec3';
import type { PoolInput } from '../renderer/plan/instancePools';
import {
  batchFoliagePools,
  FOLIAGE_SHAPES,
  layoutFoliage,
} from '../scenery/foliagePlan';
import { layoutReeds, layoutRocks, ROCK_SPECIES } from '../scenery/reedRockPlan';
import { layoutLandscape, layoutToBuildingSpecs } from '../scenery/landscapeLayout';
import {
  getRouteSceneryTrack,
  trackWaterForProfile,
} from '../../components/rower3d/sceneryTrack';
import { SCENERY_PROFILES } from '../../components/rower3d/sceneryConfig';
import type { BuildingSpec } from '../renderer/plan/buildings';
import {
  budgetFor,
  computePlacements,
  distinctProfiles,
  keepsKitTrees,
  type PerformanceMode,
  type Placement,
} from '../scenery/sceneryPlacement';
import {
  computeStructurePlacements,
  routeStructures,
} from '../scenery/sceneryStructures';
import {
  resolveSceneryModels,
  type ResolvedScenery,
  type SceneryModelId,
} from '../../components/rower3d/sceneryAssets';
import { resolveRegion } from '../../components/rower3d/sceneryRegion';
import type { SceneryProfile } from '../services/routeEnrichmentService';
import { buildTerrainProfile } from '../services/routeEnrichmentService';

/**
 * Default navigable water width in metres. Mirrors
 * `src/components/rower3d/constants.ts`'s `WATER_CHANNEL_WIDTH`, used when
 * the enrichment carries no explicit `waterWidthMeters` either.
 */
const DEFAULT_WATER_CHANNEL_WIDTH_METERS = 20;

/** Mirrors `LOOP_CLOSURE_TOLERANCE_METERS` in the React curve builder. */
export const LOOP_CLOSURE_TOLERANCE_METERS = 5;

export interface WaterEdges {
  left: number;
  right: number;
}

/** Chunk size (metres of route) used when batching foliage into per-chunk pools. */
export const FOLIAGE_CHUNK_METRES = 150;

/** One GLB-asset instance in world space, ready for `sceneryMeshPass.setInstances`. */
export interface SceneryInstance {
  position: [number, number, number];
  rotationY: number;
  scale: number;
}

/** All GLB instances for one `SceneryModelId`, so the engine knows what to load. */
export interface SceneryGlbGroup {
  id: SceneryModelId;
  instances: SceneryInstance[];
}

/** The engine-facing route shape (structural match for `SceneryRoute`). */
export interface EngineRoute {
  /** Foliage instance pools, one per (species, chunk). */
  pools: PoolInput[];
  /** Procedural facade buildings along the banks (`landscapeLayout` → `BuildingSpec[]`). */
  buildings?: BuildingSpec[];
  /** GLB scenery (bank-edge, scatter, buildings, trees, landform, backdrop,
   * course furniture, bridges, landmarks) — one group per model id. */
  sceneryGlbs?: SceneryGlbGroup[];
  /** World-space boat/ghost curve; omitted when the route has too few points. */
  curvePoints?: [number, number, number][];
  /** Real route length in metres, matching the shell's finish detection. */
  totalDistanceMeters?: number;
  /** True when the GPS polyline closes back on itself (≥4 coords, ≤5 m apart). */
  isClosedLoop?: boolean;
  /**
   * Per-progress shore widths in scene units. Called at engine attach time
   * (not per frame), so it's safe to keep the closure alive for the life of
   * the row screen. Omitted when the route has no enrichment — the engine
   * then applies its symmetric fallback.
   */
  waterEdgesForProgress?: (progress: number) => WaterEdges;
  /**
   * Dominant biome profile along the route — the first profile the enrichment
   * mentions, or 'fallback' when there is none. The bank pass uses it to pick
   * the baked density tile for its grass modulation (#496). One profile per
   * route for now; the per-segment React approach is a follow-up.
   */
  dominantProfile?: SceneryProfile;
}

/** Default OSM building height when the tags carry neither `height` nor levels. */
const DEFAULT_OSM_BUILDING_HEIGHT_M = 6;
/** Minimum footprint area in m² to be worth drawing as a prism. */
const MIN_OSM_BUILDING_FOOTPRINT_M2 = 4;

const osmBuildingToSpec = (
  osm: OsmBuilding,
  origin: { lat: number; lng: number },
): BuildingSpec | null => {
  if (!osm.footprint || osm.footprint.length < 3) return null;
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const p of osm.footprint) {
    if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng)) continue;
    const { x, y } = latLngToMeters(p.lat, p.lng, origin.lat, origin.lng);
    // Scene +Z = south, so project y (north) onto −Z.
    const sceneZ = -y;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (sceneZ < minZ) minZ = sceneZ;
    if (sceneZ > maxZ) maxZ = sceneZ;
  }
  if (!Number.isFinite(minX)) return null;
  const halfWidth = (maxX - minX) / 2;
  const halfDepth = (maxZ - minZ) / 2;
  if (halfWidth * halfDepth * 4 < MIN_OSM_BUILDING_FOOTPRINT_M2) return null;
  return {
    x: (minX + maxX) / 2,
    z: (minZ + maxZ) / 2,
    halfWidth,
    halfDepth,
    height: osm.heightMeters ?? DEFAULT_OSM_BUILDING_HEIGHT_M,
    profile: osm.kind === 'commercial' || osm.kind === 'retail'
      ? 'commercial'
      : osm.kind === 'house' || osm.kind === 'residential' || osm.kind === 'apartments'
        ? 'residential'
        : 'fallback',
  };
};

const detectClosedLoop = (route: WaterRoute): boolean => {
  const coords = route.coordinates ?? [];
  if (coords.length < 4) return false;
  const first = coords[0];
  const last = coords[coords.length - 1];
  return (
    distanceBetweenLatLng(first.lat, first.lng, last.lat, last.lng) <= LOOP_CLOSURE_TOLERANCE_METERS
  );
};

/**
 * Build the engine route from the selected {@link WaterRoute}, or `null` when
 * nothing is selected (the caller then mounts the engine with no route).
 *
 * `totalDistanceMeters` is `distance × 1000` to match `RideSessionStore`'s own
 * finish detection (`route.distance * 1000`), so the engine's progress
 * (`distanceMeters / totalDistanceMeters`) and the finish line agree. It is
 * omitted for a zero-length route so the engine falls back to the curve's own
 * chord length rather than snapping progress to a 1 m course.
 */
/**
 * Default tier used when no caller passes one through. Matches React's
 * `resolvePerformanceMode()` fallback for a browser-less or probe-free
 * invocation: real users get `'medium'`, which is what unit tests exercise.
 * The `/row` page always passes a real tier so this only applies to tests
 * and other callers that don't care about scenery density.
 */
export const DEFAULT_SCENERY_TIER: PerformanceMode = 'medium';

export const toEngineRoute = (
  route: WaterRoute | null | undefined,
  enrichment?: RouteEnrichmentData | null,
  tier: PerformanceMode = DEFAULT_SCENERY_TIER,
): EngineRoute | null => {
  if (!route) return null;

  const curvePoints = routeCurvePoints(route.coordinates ?? []);
  const totalDistanceMeters = route.distance > 0 ? route.distance * 1000 : undefined;
  const isClosedLoop = detectClosedLoop(route);

  // The water-edges fn is built even without enrichment so the engine can
  // use a width that reflects a `waterWidthMeters` carried on a fallback
  // enrichment (what the React scene does via defaultWaterWidthMeters).
  const fallbackWidthMeters =
    enrichment?.waterWidthMeters ?? DEFAULT_WATER_CHANNEL_WIDTH_METERS / SCENE_SCALE;
  const waterEdgesForProgress = (progress: number): WaterEdges =>
    getWaterEdgesSceneUnitsForProgress(
      enrichment?.segmentProfiles,
      fallbackWidthMeters,
      progress,
    );

  // Populate the foliage pools and facade buildings from the same
  // deterministic layouts the React scene uses. Three-free:
  // `src/lib/scenery/*` samples the curve through `RouteCurve` and shares
  // `getSegmentSceneryProfile`, `SCENERY_PROFILES`, `SceneryTrack` with the
  // React side.
  const pools: PoolInput[] = [];
  let buildings: BuildingSpec[] = [];
  let sceneryGlbsResult: SceneryGlbGroup[] = [];
  if (curvePoints.length >= 2) {
    const curve = new RouteCurve(
      curvePoints.map(([x, y, z]) => vec3(x, y, z)),
      isClosedLoop,
    );
    const track = getRouteSceneryTrack(route.id);
    const trees = layoutFoliage({
      curve,
      enrichment: enrichment ?? null,
      track,
      speciesTypes: FOLIAGE_SHAPES,
    });
    // #591-fu: reeds + rocks go through the same pool-batching path as the
    // tree layouts (same `FoliageTree` shape, species indices 3/4). The
    // solid-flora stage switches geometry on `speciesIndex` and the sprite
    // pass collapses the billboard to zero for 3/4, so no new pool kind is
    // needed.
    const reeds = layoutReeds({ curve, enrichment: enrichment ?? null, track });
    const rocks = layoutRocks({ curve, enrichment: enrichment ?? null, track });
    const groundProps = [...trees, ...reeds, ...rocks];
    const speciesCount = Math.max(FOLIAGE_SHAPES.length, ROCK_SPECIES + 1);
    const routeLength = (totalDistanceMeters ?? curve.approximateLength(32)) || 1;
    pools.push(...batchFoliagePools(groundProps, speciesCount, routeLength, FOLIAGE_CHUNK_METRES));

    const landscape = layoutLandscape({ curve, enrichment: enrichment ?? null, track });
    buildings = layoutToBuildingSpecs(landscape, SCENERY_PROFILES);
    // Real OSM buildings on top of the procedural facades (#549 slice 4).
    // Convert each footprint to an axis-aligned prism anchored at the
    // first route coordinate so lat/lng → scene metres uses one origin.
    const origin = route.coordinates?.[0];
    if (origin && enrichment?.buildings?.length) {
      for (const osm of enrichment.buildings) {
        const spec = osmBuildingToSpec(osm, origin);
        if (spec) buildings.push(spec);
      }
    }

    // GLB scenery (bank-edge, scatter, buildings, trees, landform, backdrop,
    // bridges, landmarks, finish-area furniture). The `/row` adapter is where
    // the layout runs so the engine stays about rendering; this is pure maths
    // on the curve + enrichment + track, matching the React scene's pipeline.
    // Prior to #591-fu the mode was hard-wired to 'medium', which suppressed
    // GLB kit trees entirely (`keepsKitTrees` is true only on high/extra-high)
    // and pinned the per-step placement loop at a 0.7 budget. React resolves
    // the real device tier via `resolvePerformanceMode()` and hands it to the
    // scene, so a given rig gets the matching density on both engines. The
    // `/row` page now plumbs that same tier here; `DEFAULT_SCENERY_TIER` keeps
    // tests and other no-arg callers deterministic at `'medium'`.
    const mode: PerformanceMode = tier;
    const budget = budgetFor(mode);
    const profiles: SceneryProfile[] = distinctProfiles(enrichment ?? null, track);
    const region = resolveRegion(route.coordinates ?? null);
    const resolvedByProfile = new Map<SceneryProfile, ResolvedScenery>();
    for (const profile of profiles) {
      const waterType = track ? trackWaterForProfile(track, profile) : (enrichment?.waterBodyType ?? 'unknown');
      const treeSpecies = SCENERY_PROFILES[profile]?.trees.species ?? [];
      resolvedByProfile.set(profile, resolveSceneryModels(profile, waterType, treeSpecies, region));
    }
    const kitTrees = keepsKitTrees(mode);
    const left = computePlacements({ curve, enrichment: enrichment ?? null, resolvedByProfile, budget, side: 'left', track, kitTrees });
    const right = computePlacements({ curve, enrichment: enrichment ?? null, resolvedByProfile, budget, side: 'right', track, kitTrees });
    const requests = routeStructures({
      side: 'left',
      hasCurve: true,
      coordinates: route.coordinates ?? null,
      crossings: enrichment?.crossings ?? null,
      routeMeters: totalDistanceMeters,
    });
    const terrain = buildTerrainProfile(enrichment?.elevations);
    const structures: Placement[] = computeStructurePlacements(curve, requests, terrain, enrichment ?? null);
    const grouped = new Map<SceneryModelId, SceneryInstance[]>();
    for (const p of [...left, ...right, ...structures]) {
      const list = grouped.get(p.id) ?? [];
      list.push({ position: p.position, rotationY: p.rotationY, scale: p.scale });
      grouped.set(p.id, list);
    }
    sceneryGlbsResult = [...grouped.entries()].map(([id, instances]) => ({ id, instances }));
  }

  // Pick the dominant biome profile the bank pass's grass-density chunk
  // (#496) will key its density tile off. A route may cover several profiles;
  // one tile per route is good enough for the current single-mesh bank, and
  // matches the single `fallback` the pass used before this change.
  const routeProfiles = distinctProfiles(enrichment ?? null, getRouteSceneryTrack(route.id));
  const dominantProfile: SceneryProfile = routeProfiles[0] ?? 'fallback';

  return {
    pools,
    ...(buildings.length > 0 ? { buildings } : {}),
    ...(sceneryGlbsResult.length > 0 ? { sceneryGlbs: sceneryGlbsResult } : {}),
    ...(curvePoints.length >= 2 ? { curvePoints } : {}),
    ...(totalDistanceMeters !== undefined ? { totalDistanceMeters } : {}),
    ...(isClosedLoop ? { isClosedLoop } : {}),
    waterEdgesForProgress,
    dominantProfile,
  };
};
