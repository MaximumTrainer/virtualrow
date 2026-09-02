// Concept2 PM5 Bluetooth Service UUIDs and characteristics
export const PM5_SERVICE_UUID = '0xCE060000-43E5-11E4-916C-0800200C9A66';
export const PM5_RX_CHAR_UUID = '0xCE060001-43E5-11E4-916C-0800200C9A66';
export const PM5_TX_CHAR_UUID = '0xCE060002-43E5-11E4-916C-0800200C9A66';

// Route coordinates
export interface Coordinate {
  lat: number;
  lng: number;
}

/**
 * Where an imported route's polyline came from (issue #194).
 *
 * - `track`        a user-attached GPX/KML/GeoJSON, or an upstream traced path
 * - `polygon-path` a path-shaped polygon already in the course file
 * - `osm-derived`  walked along OpenStreetMap waterway centrelines
 * - `gate-chain`   start/finish gate centroids only, so straight lines between
 */
export type GeometrySource = 'track' | 'polygon-path' | 'osm-derived' | 'gate-chain';

// Route enrichment metadata (optional - only present when route has been enriched)
export interface RouteEnrichmentMetadata {
  enrichedAt: number; // timestamp when enrichment was performed
  hasElevationData: boolean;
  hasOSMData: boolean;
  waterBodyType: 'river' | 'canal' | 'lake' | 'stream' | 'unknown';
  defaultBankWidth: number;
  pointCount: number; // number of enriched coordinate points
}

// Water route definition
export interface WaterRoute {
  id: string;
  name: string;
  description: string;
  distance: number; // in kilometers
  difficulty: 'easy' | 'moderate' | 'hard';
  location: string;
  coordinates: Coordinate[];
  elevationGain: number;
  estimatedTime: number; // in minutes
  imageUrl?: string;
  tags: string[];
  createdAt: Date;
  userRating?: number;
  source?: 'manual' | 'imported' | 'rownative';
  /** Identifier of this route in its source system (e.g. a rownative course id). */
  externalId?: string;
  /** How `coordinates` was arrived at. Set for every rownative import. */
  geometrySource?: GeometrySource;
  /**
   * Distance the source system reports, in metres, kept for display only.
   *
   * `distance` is always measured from `coordinates`, so the card and the boat
   * can never disagree; rownative's `distance_m` is a straight-line gate chain
   * by definition and is shown alongside ours when the two differ materially.
   */
  externalDistanceMeters?: number;
  enrichment?: RouteEnrichmentMetadata; // Optional enrichment metadata
}

/**
 * One second of a row, as the rower and strap reported it (issue #221, R1).
 *
 * Optional fields are absent rather than zero when the hardware said nothing:
 * a row with no strap must not encode as a row at 0 bpm.
 */
export interface ActivitySample {
  /** Seconds since session start. Strictly increasing; a pause leaves a gap. */
  t: number;
  /** Cumulative metres rowed. */
  distance: number;
  /** Seconds per 500 m. */
  pace?: number;
  /** Watts. */
  power?: number;
  /** Strokes per minute. */
  cadence?: number;
  /** Beats per minute. */
  heartRate?: number;
  /** Position on the route polyline at this distance. */
  lat?: number;
  lng?: number;
}

// Workout session data
export interface WorkoutSession {
  id: string;
  routeId: string;
  routeName: string;
  startTime: Date;
  endTime?: Date;
  duration: number; // in seconds
  distance: number; // in meters
  averagePace: number; // seconds per 500m
  calories: number;
  heartRateSamples?: HeartRateSample[]; // heart rate samples captured during session
  /** 1 Hz activity stream (issue #221, R1) — what the FIT encoder writes records from. */
  samples: ActivitySample[];
  heartRateAvg?: number; // persisted average bpm at end of session
  heartRateMax?: number; // persisted max bpm at end of session
  splits: Split[];
  isActive: boolean;
  structuredWorkoutId?: string; // Optional link to a structured workout
  workoutProgress?: WorkoutProgress; // Progress through structured workout (if applicable)
  rowerType?: 'pm5' | 'ftms'; // Which rower device was connected at session start
  hrConnectedAtStart?: boolean; // Whether HR monitor was connected when session started
  isGuest?: boolean; // True for anonymous/guest sessions — excluded from history
  /** intervals.icu activity id, set once the row has been uploaded (issue #221, AC6.2). */
  uploadedActivityId?: string;
}

// Individual split data (500m segments typical for rowing)
export interface Split {
  distance: number; // in meters
  time: number; // in seconds
  pace: number; // seconds per 500m
  power?: number; // watts
  heartRate?: number;
  timestamp: Date;
}

// PM5 device data
export interface PM5Data {
  pace?: number; // seconds per 500m (optional, may not always be available)
  distance: number; // in meters
  elapsedTime: number; // seconds since the row began (PM5 centiseconds x 0.01; FTMS whole seconds)
  power?: number; // watts
  cadence?: number; // strokes per minute
  heartRate?: number;
  calories?: number;
  intervals?: number;
  averagePace?: number;
}

// Single heart rate sample captured from BLE Heart Rate Measurement characteristic
export interface HeartRateSample {
  bpm: number;
  timestamp: Date;
}

// Bluetooth device connection state
export interface BluetoothDeviceState {
  isConnected: boolean;
  deviceName?: string;
  battery?: number;
  lastUpdate?: Date;
  error?: string;
}

// Map layer definitions
export interface MapLayer {
  id: string;
  name: string;
  type: 'satellite' | 'terrain' | 'streets';
  attribution: string;
  url: string;
  enabled: boolean;
}

// User profile
export interface UserProfile {
  id: string;
  name: string;
  email: string;
  favoriteRoutes: string[];
  personalBest: {
    routeId: string;
    time: number;
    pace: number;
  }[];
  totalDistance: number;
  totalWorkouts: number;
  preferences: {
    units: 'metric' | 'imperial';
    theme: 'light' | 'dark';
    notifications: boolean;
  };
}

/**
 * Authenticated user from intervals.icu OAuth.
 * Access token is never included here — it lives in AuthService memory only.
 */
export interface AuthUser {
  /** intervals.icu athlete ID (e.g. "i12345") */
  id: string;
  name: string;
  email: string;
  avatarUrl?: string;
}

/** OAuth token pair. Access token is memory-only; refresh token in sessionStorage. */
export interface OAuthTokens {
  accessToken: string;
  /** Seconds until the access token expires (relative to issuance) */
  expiresIn: number;
  /** Unix timestamp (ms) at which the access token expires */
  expiresAt: number;
  refreshToken?: string;
  tokenType: string;
  athleteId: string;
}

// Bluetooth message types for PM5 communication
export interface PM5Message {
  type: string;
  data: unknown;
}

// Route creation/editing
export interface RouteFormData {
  name: string;
  description: string;
  location: string;
  difficulty: 'easy' | 'moderate' | 'hard';
  coordinates: Coordinate[];
  tags: string[];
  imageUrl?: string;
  distanceKm?: number;
  estimatedTimeMin?: number;
  source?: WaterRoute['source'];
  externalId?: WaterRoute['externalId'];
  geometrySource?: WaterRoute['geometrySource'];
  externalDistanceMeters?: WaterRoute['externalDistanceMeters'];
}

// Structured workout with intervals (like intervals.icu)
export interface StructuredWorkout {
  id: string;
  name: string;
  description: string;
  type: 'intervals' | 'steady-state' | 'pyramid' | 'custom';
  segments: WorkoutSegment[];
  totalDuration: number; // in seconds
  totalDistance?: number; // in meters (optional)
  targetMetric: 'pace' | 'power' | 'heartRate' | 'distance' | 'time';
  createdAt: Date;
  source?: 'intervals.icu' | 'manual' | 'imported';
  externalId?: string; // For intervals.icu integration
  routeId?: string; // Optional: specific route to use with this workout
}

export interface IntervalBlock {
  id: string;
  type: WorkoutSegment['type'];
  label: string;
  durationSec: number;
  targetPowerWatts?: number;
  targetPaceMin?: number;
  targetPaceMax?: number;
  intensity?: WorkoutSegment['intensity'];
}

export interface WorkoutPlan {
  id: string;
  name: string;
  summary: string;
  scheduledDate?: string;
  source: 'intervals.icu' | 'manual' | 'imported';
  blocks: IntervalBlock[];
  totalDurationSec: number;
}

// Individual segment/interval in a structured workout
export interface WorkoutSegment {
  id: string;
  order: number;
  type: 'warmup' | 'work' | 'rest' | 'cooldown' | 'interval';
  duration?: number; // in seconds (null for distance-based)
  distance?: number; // in meters (null for time-based)
  targetPaceMin?: number; // min pace in seconds per 500m
  targetPaceMax?: number; // max pace in seconds per 500m
  targetPower?: number; // in watts
  targetHeartRateMin?: number; // in bpm
  targetHeartRateMax?: number; // in bpm
  intensity?: 'recovery' | 'zone1' | 'zone2' | 'zone3' | 'zone4' | 'zone5' | 'max';
  cadence?: number; // target strokes per minute
  repeat?: number; // number of repetitions
  description?: string;
}

// Workout progress tracking during active structured workout
export interface WorkoutProgress {
  workoutId: string;
  currentSegmentIndex: number;
  currentSegment: WorkoutSegment;
  segmentElapsedTime: number; // seconds into current segment
  segmentProgress: number; // percentage (0-100)
  totalElapsedTime: number; // seconds into entire workout
  totalProgress: number; // percentage (0-100)
  isOnTarget: boolean; // whether user is meeting target metrics
  deviationPercent?: number; // how far off target (positive = too fast, negative = too slow)
  isComplete?: boolean; // true when the final segment has completed
}

// Global window extensions used by Playwright E2E tests and dev tooling
declare global {
  interface Window {
    __PLAYWRIGHT_TESTING?: boolean;
    __PM5_DATA?: PM5Data;
    /**
     * The live WorkoutService, exposed only under __PLAYWRIGHT_TESTING so an
     * E2E test can start and end sessions without driving the UI.
     *
     * Typed as the narrow surface the tests actually use rather than the whole
     * service: `unknown` forced every call-site through an `any` cast, which
     * meant a renamed method broke the suite at runtime instead of at build.
     */
    __workoutService?: {
      startSession(routeId: string, routeName: string, structuredWorkoutId?: string, rowerType?: 'pm5' | 'ftms', hrConnectedAtStart?: boolean, isGuest?: boolean): WorkoutSession;
      getCurrentSession(): WorkoutSession | null;
      getAllSessions(): WorkoutSession[];
      endSession(): WorkoutSession | null;
      updateSessionHeartRate(bpm: number): void;
      exportSessionsAsCSV(): string;
    };
    __PM5_SIMULATOR_PORT?: number;
    // Rower3D telemetry exposed for Playwright assertions
    __ROWER3D_POS?: { x: number; y: number; z: number; progress: number; angle: number };
    __ROWER3D_CAMERA?: { position: [number, number, number] };
    __ROWER3D_ROUTE?: { hasCurve: boolean; totalDistance: number; curveLength: number; builds?: number };
    __ROWER3D_SPEED_MPS?: number;
    __ROWER3D_STROKE_PHASE?: string;
    __ROWER3D_DISTANCE_M?: number;
    __ROWER3D_OAR_ANGLE?: number;
    __ROWER3D_STROKE_RATE?: number;
    __ROWER3D_GPU_BACKEND?: string;
    __ROWER3D_WEBGL_LOST?: boolean;
    __ROWER3D_MAX_ANISOTROPY?: number;
    __ROWER3D_FRAME_STATS?: {
      frames: number;
      windowSeconds: number;
      fps: number;
      p50Ms: number;
      p95Ms: number;
      maxMs: number;
    };
    __ROWER3D_MEMORY?: {
      geometryBytes: number;
      geometryMb: number;
      geometries: number;
      textures: number;
    };
    /**
     * The selected route's headline numbers, for Playwright assertions.
     *
     * Exposed so an E2E test can check that what the card says and what the
     * engine rows are the same number (issue #194 AC-7) without reaching into
     * React state.
     */
    __SELECTED_ROUTE?: {
      id: string;
      name: string;
      distanceKm: number;
      geometrySource?: GeometrySource;
      externalDistanceMeters?: number;
    };
    // Auth testing — set by E2E tests to inject a mock authenticated user
    __AUTH_USER?: AuthUser | null;
    __AUTH_TOKENS?: OAuthTokens | null;
  }
}
