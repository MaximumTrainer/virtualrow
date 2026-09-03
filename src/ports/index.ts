/**
 * Application ports (in the Hexagonal Architecture sense).
 *
 * Each port describes the *application-facing* contract of a service. The
 * concrete adapter implementations live under `src/services/` (real
 * implementations) and can be swapped out for stubs in tests / Storybook.
 *
 * Each port is a `Pick` of the members its call-sites actually use, so a stub
 * is an ordinary object and is checked structurally. Do not alias a port to a
 * class: a class type carries its private fields, which no stub can supply, so
 * every fake needs an `as unknown as` cast — and a cast accepts a stub that has
 * drifted from the real service just as happily as one that matches (#204).
 *
 * New call-sites should depend on the port type, not on the concrete class.
 */
import type {
  Concept2BluetoothService,
} from '../services/bluetoothService';
import type { FTMSBluetoothService } from '../services/ftmsBluetoothService';
import type { HeartRateBluetoothService } from '../services/heartRateBluetoothService';
import type { RouteService } from '../services/routeService';
import type { WorkoutGeneratorService } from '../services/workoutGeneratorService';
import type { WorkoutService } from '../services/workoutService';
import type { AuthService } from '../services/authService';
import type { RownativeService } from '../services/rownativeService';
import type { RouteEnrichmentService } from '../services/routeEnrichmentService';
import type { DefaultRoutePreferenceStore } from '../services/defaultRoutePreferenceStore';
import type { IntervalsIcuActivityService } from '../services/intervalsIcuActivityService';
import type { IntervalsIcuWorkoutService } from '../services/intervalsIcuWorkoutService';

/** Port for the PM5 Bluetooth integration. */
export type PM5BluetoothPort = Pick<
  Concept2BluetoothService,
  'connect' | 'disconnect' | 'sendCommand' | 'getPM5Data' | 'isConnected' | 'on' | 'off'
>;

/** Port for generic FTMS (Fitness Machine Service) rower integration. */
export type FTMSBluetoothPort = Pick<
  FTMSBluetoothService,
  'connect' | 'disconnect' | 'getLatestData' | 'isConnected' | 'on' | 'off'
>;

/** Port for an external heart-rate monitor BLE integration. */
export type HeartRateBluetoothPort = Pick<
  HeartRateBluetoothService,
  | 'connect'
  | 'disconnect'
  | 'isConnected'
  | 'getSamples'
  | 'simulateSample'
  | 'simulateConnected'
  | 'simulateDisconnected'
  | 'on'
  | 'off'
>;

/** Port for water-route catalogue queries / imports. */
export type RoutePort = Pick<
  RouteService,
  | 'getAllRoutes'
  | 'getRouteById'
  | 'searchRoutes'
  | 'createRoute'
  | 'updateRoute'
  | 'deleteRoute'
  | 'importRouteFromGPX'
  | 'importRouteFromGeoJSON'
  | 'importRouteFromKML'
  | 'finalizeKMLImport'
  | 'importRouteFromRownative'
  | 'findRouteByRownativeId'
>;

/** Port for the structured-workout generator. */
export type WorkoutGeneratorPort = Pick<
  WorkoutGeneratorService,
  | 'getAllWorkouts'
  | 'getWorkoutById'
  | 'addWorkout'
  | 'startWorkout'
  | 'endWorkout'
  | 'updateProgress'
  | 'getCurrentProgress'
  | 'getCurrentWorkout'
  | 'getExpandedCurrentSegments'
  | 'expandSegments'
  | 'getSpeedAdjustmentFactor'
  | 'importFromIntervalsICU'
  | 'resumeAfterGap'
>;

/**
 * Port for the athlete's planned workouts on intervals.icu.
 *
 * Reached with the OAuth access token a signed-in rower already has, so the
 * calendar is available without asking them for an API key (#67).
 */
export type IntervalsIcuWorkoutPort = Pick<
  IntervalsIcuWorkoutService,
  'fetchPlannedRowingWorkouts' | 'toStructuredWorkout'
>;

/** Port for workout session lifecycle + history. */
export type WorkoutPort = Pick<
  WorkoutService,
  | 'startSession'
  | 'endSession'
  | 'pauseSession'
  | 'resumeSession'
  | 'updateSessionWithPM5Data'
  | 'updateSessionHeartRate'
  | 'updateWorkoutProgress'
  | 'getCurrentSession'
  | 'getSessionById'
  | 'getAllSessions'
  | 'getSessionsByRoute'
  | 'getRecentSessions'
  | 'getStats'
  | 'deleteSession'
  | 'exportSessionsAsJSON'
  | 'exportSessionsAsCSV'
>;

/** Port for OAuth authentication via intervals.icu. */
export type AuthPort = Pick<
  AuthService,
  | 'startLogin'
  | 'handleCallback'
  | 'logout'
  | 'getUser'
  | 'getAccessToken'
  | 'getLastError'
  | 'refreshAccessToken'
  | 'scheduleRefresh'
  | 'isAuthenticated'
>;

/** Port for rownative course discovery/import. */
export type RownativePort = Pick<
  RownativeService,
  | 'getCourseIndex'
  | 'searchCourses'
  | 'importCourse'
  | 'importCourseById'
  | 'resolveCourseId'
  | 'fetchCourseGeometry'
>;

/**
 * Port for route geospatial data enrichment.
 *
 * Unlike the aliases above this is a *method surface*, not the concrete class,
 * so a test or story can satisfy it with a plain object of stubs rather than
 * an instance of `RouteEnrichmentService`.
 */
export type RouteEnrichmentPort = Pick<
  RouteEnrichmentService,
  'enrichRoute' | 'readCached' | 'clearCache' | 'clearAllCache'
>;

/**
 * Port for the per-athlete default-route preference (issue #219, R6).
 *
 * Backed by localStorage today; the shape is deliberately storage-agnostic so
 * the Postgres layer (#37) can replace the adapter without touching call-sites.
 */
export type DefaultRoutePreferencePort = Pick<
  DefaultRoutePreferenceStore,
  | 'getDefaultRouteId'
  | 'setDefaultRouteId'
  | 'clearDefaultRouteId'
  | 'resolveDefaultRouteId'
>;

/**
 * Port for uploading a completed row to intervals.icu (issue #221, R3).
 */
export type ActivityUploadPort = Pick<IntervalsIcuActivityService, 'uploadActivity'>;

/**
 * Aggregate of every port the app composition root needs. Consumed by the
 * React `ServicesProvider` and the `useServices()` hook.
 */
export interface Services {
  workoutService: WorkoutPort;
  routeService: RoutePort;
  workoutGeneratorService: WorkoutGeneratorPort;
  intervalsIcuWorkoutService: IntervalsIcuWorkoutPort;
  pm5BluetoothService: PM5BluetoothPort;
  ftmsBluetoothService: FTMSBluetoothPort;
  heartRateBluetoothService: HeartRateBluetoothPort;
  authService: AuthPort;
  rownativeService: RownativePort;
  routeEnrichmentService: RouteEnrichmentPort;
  defaultRoutePreferenceStore: DefaultRoutePreferencePort;
  intervalsIcuActivityService: ActivityUploadPort;
}
