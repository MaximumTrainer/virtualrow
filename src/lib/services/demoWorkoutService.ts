import type { StructuredWorkout } from '../types';
import { demoIntervalWorkout } from '../data/demoWorkout';

/**
 * Produces the placeholder structured workout for the signed-out demo route
 * (#472 FR2). A plain port over a bundled constant: no network, no auth,
 * nothing to mock out beyond swapping the port for a stub in tests.
 */
export class DemoWorkoutService {
  getDemoWorkout(): StructuredWorkout {
    return demoIntervalWorkout;
  }
}

export const demoWorkoutService = new DemoWorkoutService();
