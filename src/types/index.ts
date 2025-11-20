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
  pace: number; // seconds per 500m
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
