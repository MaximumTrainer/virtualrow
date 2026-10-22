/**
 * Shell route → engine `SceneryRoute` adapter (#570 AC2).
 *
 * The `/row` screen hands the WebGPU engine a route through the `rideCanvas`
 * seam. The engine treats the route as `unknown` and only acts on it when it
 * is a `SceneryRoute` — an object with a `pools` array — reading `curvePoints`
 * (world-space points for the boat/ghost curve) and `totalDistanceMeters` (the
 * real route length it maps row distance onto). A plain `WaterRoute` has
 * neither, so without this adapter the engine falls back to a canned straight
 * line and the boat never follows the selected route.
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
import { routeCurvePoints } from '../utils/routeWorldCurve';

/** The engine-facing route shape (structural match for `SceneryRoute`). */
export interface EngineRoute {
  /** No scenery instancing in this slice; present so `isSceneryRoute` holds. */
  pools: never[];
  /** World-space boat/ghost curve; omitted when the route has too few points. */
  curvePoints?: [number, number, number][];
  /** Real route length in metres, matching the shell's finish detection. */
  totalDistanceMeters?: number;
}

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
export const toEngineRoute = (route: WaterRoute | null | undefined): EngineRoute | null => {
  if (!route) return null;

  const curvePoints = routeCurvePoints(route.coordinates ?? []);
  const totalDistanceMeters = route.distance > 0 ? route.distance * 1000 : undefined;

  return {
    pools: [],
    ...(curvePoints.length >= 2 ? { curvePoints } : {}),
    ...(totalDistanceMeters !== undefined ? { totalDistanceMeters } : {}),
  };
};
