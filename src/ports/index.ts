/**
 * Application ports (in the Hexagonal Architecture sense).
 *
 * Each port describes the *application-facing* contract of a service. The
 * concrete adapter implementations live under `src/services/` (real
 * implementations) and can be swapped out for stubs in tests / Storybook.
 *
 * To keep the migration low-risk, the port shapes here are *structurally*
 * compatible with the existing concrete classes (derived via `typeof`). New
 * call-sites should depend on the port type, not on the concrete class.
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

/** Port for the PM5 Bluetooth integration. */
export type PM5BluetoothPort = Concept2BluetoothService;

/** Port for generic FTMS (Fitness Machine Service) rower integration. */
export type FTMSBluetoothPort = FTMSBluetoothService;

/** Port for an external heart-rate monitor BLE integration. */
export type HeartRateBluetoothPort = HeartRateBluetoothService;

/** Port for water-route catalogue queries / imports. */
export type RoutePort = RouteService;

/** Port for the structured-workout generator. */
export type WorkoutGeneratorPort = WorkoutGeneratorService;

/** Port for workout session lifecycle + history. */
export type WorkoutPort = WorkoutService;

/** Port for OAuth authentication via intervals.icu. */
export type AuthPort = AuthService;

/**
 * Aggregate of every port the app composition root needs. Consumed by the
 * React `ServicesProvider` and the `useServices()` hook.
 */
export interface Services {
  workoutService: WorkoutPort;
  routeService: RoutePort;
  workoutGeneratorService: WorkoutGeneratorPort;
  pm5BluetoothService: PM5BluetoothPort;
  ftmsBluetoothService: FTMSBluetoothPort;
  heartRateBluetoothService: HeartRateBluetoothPort;
  authService: AuthPort;
}
