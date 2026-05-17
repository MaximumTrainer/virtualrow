// Concept2 PM5 Bluetooth Service UUIDs and characteristics
export const PM5_SERVICE_UUID = '0xCE060000-43E5-11E4-916C-0800200C9A66';
export const PM5_RX_CHAR_UUID = '0xCE060001-43E5-11E4-916C-0800200C9A66';
export const PM5_TX_CHAR_UUID = '0xCE060002-43E5-11E4-916C-0800200C9A66';

// Route coordinates
export interface Coordinate {
  lat: number;
  lng: number;
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
  heartRateSamples?: HeartRateSample[]; // rolling heart rate samples captured during session
  heartRateAvg?: number; // persisted average bpm at end of session
  heartRateMax?: number; // persisted max bpm at end of session
  splits: Split[];
  isActive: boolean;
  structuredWorkoutId?: string; // Optional link to a structured workout
  workoutProgress?: WorkoutProgress; // Progress through structured workout (if applicable)
  rowerType?: 'pm5' | 'ftms'; // Which rower device was connected at session start
  hrConnectedAtStart?: boolean; // Whether HR monitor was connected when session started
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
  elapsedTime: number; // in milliseconds
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
}
