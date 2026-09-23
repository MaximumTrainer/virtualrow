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
import React, { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { useGLTF } from '@react-three/drei';
import type { PerformanceMode } from './constants';
import {
  buildTerrainProfile,
  type RouteEnrichmentData,
  type SceneryProfile,
} from '../../services/routeEnrichmentService';
import { SCENERY_PROFILES } from './sceneryConfig';
import {
  resolveSceneryModels,
  collectSceneryPaths,
  sceneryAssetPath,
  type ResolvedScenery,
  type SceneryModelId,
} from './sceneryAssets';
import { trackWaterForProfile, type SceneryTrack } from './sceneryTrack';
import type { SceneryRegion } from './sceneryRegion';
import type { Coordinate } from '../../types/index';
import {
  computeStructurePlacements,
  routeStructures,
  type StructureRequest,
} from './sceneryStructures';
import {
  budgetFor,
  distinctProfiles,
  computePlacements,
  type Placement,
} from './sceneryPlacement';
import { useAnimationFrame } from './animationFrame';
import { cullByDistance, withinMountRange } from './visibilityCull';
import { chunkViewDistanceFor } from './fogPlan';

/**
 * Frames between scenery culls.
 *
 * The test is over every placement on the route, and a tree does not come
 * into view in a sixtieth of a second.
 */
export const SCENERY_CULL_FRAME_INTERVAL = 6;

interface SceneryModelsProps {
  side?: 'left' | 'right';
  boatZ?: number;
  /**
   * Where the boat is, read every few frames to decide what is worth drawing.
   *
   * A ref rather than a number: this used to be `boatProgress`, a prop pushed
   * from `setSceneryState` ten times a second, and every push rebuilt the JSX
   * below — mounting and unmounting `<primitive>` groups as the boat moved
   * (#331). Nothing re-renders now; `object.visible` is written in place.
   */
  positionRef?: React.RefObject<THREE.Vector3 | null>;
  /**
   * Progress the mounted window is centred on (#331).
   *
   * Every mounted instance is a cloned GLB resident on the GPU, so the window
   * stays the width it was; what changed is that it moves about twenty times
   * across a route rather than three thousand.
   */
  mountProgress?: number;
  enrichment?: RouteEnrichmentData | null;
  terrainY?: number;
  performanceMode?: PerformanceMode;
  /** When provided, place along this route curve (real routes). */
  curve?: THREE.Curve<THREE.Vector3> | null;
  /** Authored dressing for a route that states its own progression (#232). */
  track?: SceneryTrack | null;
  /** Regional building kit for the route's geography (#232). */
  region?: SceneryRegion | null;
  /** Route coordinates, for pinning liveried landmarks to their real water (#232). */
  coordinates?: Coordinate[] | null;
}

/**
 * Must be rendered inside a <Suspense> boundary: it loads GLBs and will suspend
 * until they arrive.
 */
const SceneryModelsChunk: React.FC<
  SceneryModelsProps & { readyCount: number; onChunkLoaded: (total: number) => void }
> = ({
  readyCount,
  onChunkLoaded,
  side = 'left',
  boatZ = 0,
  positionRef = null,
  mountProgress = 0,
  enrichment,
  terrainY = 0,
  performanceMode = 'high',
  curve = null,
  track = null,
  region = null,
  coordinates = null,
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

  // One-off structures: the bridges the route passes under, the furniture at
  // each end, and any liveried landmark this water actually owns. Placed once
  // per route rather than per bank, so only one side renders them (#232).
  const structures = useMemo<StructureRequest[]>(
    () =>
      routeStructures({
        side,
        hasCurve: Boolean(curve),
        coordinates,
        crossings: enrichment?.crossings,
      }),
    [enrichment?.crossings, coordinates, side, curve],
  );

  // Union of every GLB the route can show — loaded once, shared across instances.
  const paths = useMemo(() => {
    const all = new Set<string>();
    for (const r of resolvedByProfile.values()) collectSceneryPaths(r).forEach((p) => all.add(p));
    // Structures are chosen per route, not per profile, so their models are not
    // in any resolved set.
    for (const s of structures) all.add(sceneryAssetPath(s.id));
    return Array.from(all);
  }, [resolvedByProfile, structures]);

  // Only the models asked for so far. useGLTF suspends until every path it is
  // handed has loaded, so slicing here is what caps the fetches in flight: a
  // demo row asked a static host for all 58 at once and earned a 503.
  const ready = useMemo(() => paths.slice(0, readyCount), [paths, readyCount]);

  const gltfs = useGLTF(ready) as unknown as Array<{ scene: THREE.Group }>;

  // Rendering means the chunk resolved, so the next one may start.
  useEffect(() => {
    onChunkLoaded(paths.length);
  }, [onChunkLoaded, paths.length, gltfs]);
  const sceneById = useMemo(() => {
    const map = new Map<SceneryModelId, THREE.Group>();
    ready.forEach((path, i) => {
      const id = path.split('/').pop()!.replace('.glb', '');
      const g = gltfs[i]?.scene;
      if (g) map.set(id, g);
    });
    return map;
  }, [ready, gltfs]);

  const budget = budgetFor(performanceMode);
  const viewDistance = chunkViewDistanceFor();

  const placements = useMemo<Placement[]>(
    () => computePlacements({ curve, enrichment, resolvedByProfile, budget, side, track }),
    [curve, enrichment, resolvedByProfile, budget, side, track],
  );

  // Same terrain profile the scatter is lifted by, so bank furniture stands on
  // the ground instead of inside it (review of #232).
  const structureTerrain = useMemo(
    () => buildTerrainProfile(enrichment?.elevations),
    [enrichment?.elevations],
  );

  const structurePlacements = useMemo<Placement[]>(
    () => computeStructurePlacements(curve, structures, structureTerrain),
    [curve, structures, structureTerrain],
  );

  const instances = useMemo(
    () =>
      [...placements, ...structurePlacements]
        .filter((p) => !curve || withinMountRange(p.progress, mountProgress))
        .map((p, i) => {
          const src = sceneById.get(p.id);
          if (!src) return null;
          return { key: `${i}-${p.id}`, obj: src.clone(true), p };
        })
        .filter((v): v is { key: string; obj: THREE.Group; p: Placement } => v !== null),
    [placements, structurePlacements, sceneById, curve, mountProgress],
  );

  // Every instance is mounted, and which of them are drawn is decided in the
  // frame loop rather than in the render (#331).
  //
  // This used to be `instances.filter(...)` on a `boatProgress` prop, keeping
  // a window of 0.12 progress either side of the boat plus the route's first
  // 6% always on. Two things were wrong with it. A progress window is not a
  // distance, so the same number meant 240 m on a 2 km route and 2.4 km on a
  // 20 km one; and the filter ran during render, so every push of the prop
  // mounted and unmounted `<primitive>` groups — a scene graph edit ten times
  // a second, which is what the periodic 100-300 ms frames were.
  //
  // The window is the fog's far plane now, because that is the honest answer
  // to "can this be seen": past it there is nothing but fog colour.
  const centres = useMemo(() => {
    const packed = new Float32Array(instances.length * 2);
    instances.forEach(({ p }, index) => {
      packed[index * 2] = p.position[0];
      packed[index * 2 + 1] = p.position[2];
    });
    return packed;
  }, [instances]);

  const groupRefs = useRef<(THREE.Group | null)[]>([]);
  const drawnRef = useRef<Uint8Array>(new Uint8Array(0));
  const frameRef = useRef(0);

  useEffect(() => {
    groupRefs.current.length = instances.length;
    drawnRef.current = new Uint8Array(instances.length);
  }, [instances.length]);

  useAnimationFrame(() => {
    const boat = positionRef?.current;
    if (!curve || !boat) return;

    // Every sixth frame: a tree does not come into view in a sixtieth of a
    // second, and the test is over every placement on the route.
    frameRef.current += 1;
    if (frameRef.current % SCENERY_CULL_FRAME_INTERVAL !== 0) return;

    const drawn = drawnRef.current;
    if (drawn.length !== groupRefs.current.length) return;

    cullByDistance(centres, boat, viewDistance, drawn);
    for (let index = 0; index < drawn.length; index += 1) {
      const group = groupRefs.current[index];
      if (group) group.visible = drawn[index] === 1;
    }
  });

  const groupPos: [number, number, number] = curve ? [0, 0, 0] : [0, terrainY, boatZ];

  return (
    <group name={SCENERY_MODELS_NAME} position={groupPos}>
      {instances.map(({ key, obj, p }, index) => (
        <group
          key={key}
          ref={(group) => {
            groupRefs.current[index] = group;
          }}
          position={p.position}
          rotation={[0, p.rotationY, 0]}
          scale={p.scale}
          // Along a route, nothing is drawn until the frame loop has said it is
          // near enough; off a route there is no boat to be near, so all of it is.
          visible={!curve}
        >
          <primitive object={obj} />
        </group>
      ))}
    </group>
  );
};

/** The name on each side's scenery group, so a test can ask whether it is mounted (#364). */
export const SCENERY_MODELS_NAME = 'SceneryModels';

/** Fetches in flight at once — small enough that a static host stays friendly. */
export const SCENERY_LOAD_CONCURRENCY = 3;

/**
 * Dress the banks, asking for the kit a few models at a time.
 *
 * A demo row at the auto tier handed the loader all 58 models at once — peak 57
 * fetches in flight — and GitHub Pages answered one of them with a 503. The
 * file was fine; the volume was not.
 *
 * The counter lives here rather than in the component below because that one
 * suspends, and a suspended component loses the state it owns: keeping the
 * count inside it restarted the first chunk forever.
 */
export const SceneryModels: React.FC<SceneryModelsProps> = (props) => {
  const [readyCount, setReadyCount] = useState(SCENERY_LOAD_CONCURRENCY);

  const handleChunkLoaded = React.useCallback((total: number) => {
    setReadyCount((current) =>
      current >= total ? current : Math.min(current + SCENERY_LOAD_CONCURRENCY, total),
    );
  }, []);

  return (
    <Suspense fallback={null}>
      <SceneryModelsChunk {...props} readyCount={readyCount} onChunkLoaded={handleChunkLoaded} />
    </Suspense>
  );
};
