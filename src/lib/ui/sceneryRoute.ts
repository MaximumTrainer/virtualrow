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
import { distanceBetweenLatLng } from '../utils/geoUtils';
import { SCENE_SCALE } from '../utils/worldScale';
import { routeCurvePoints } from '../utils/routeWorldCurve';

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

/** The engine-facing route shape (structural match for `SceneryRoute`). */
export interface EngineRoute {
  /** No scenery instancing in this slice; present so `isSceneryRoute` holds. */
  pools: never[];
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
}

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
export const toEngineRoute = (
  route: WaterRoute | null | undefined,
  enrichment?: RouteEnrichmentData | null,
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

  return {
    pools: [],
    ...(curvePoints.length >= 2 ? { curvePoints } : {}),
    ...(totalDistanceMeters !== undefined ? { totalDistanceMeters } : {}),
    ...(isClosedLoop ? { isClosedLoop } : {}),
    waterEdgesForProgress,
  };
};
