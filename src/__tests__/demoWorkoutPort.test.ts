import { describe, it, expect } from 'vitest';
import type { DemoWorkoutPort } from '../lib/ports';
import { demoWorkoutService } from '../lib/services/demoWorkoutService';
import { demoIntervalWorkout } from '../lib/data/demoWorkout';

describe('DemoWorkoutPort (#472 FR2, AC2)', () => {
  it('is satisfied structurally by a plain-object stub, no cast needed', () => {
    const stub: DemoWorkoutPort = {
      getDemoWorkout: () => demoIntervalWorkout,
    };
    expect(stub.getDemoWorkout()).toBe(demoIntervalWorkout);
  });

  it('the production service satisfies the port', () => {
    const port: DemoWorkoutPort = demoWorkoutService;
    expect(port.getDemoWorkout()).toBe(demoIntervalWorkout);
  });
});
