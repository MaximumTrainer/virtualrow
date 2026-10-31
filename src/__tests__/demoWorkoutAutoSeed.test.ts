import { describe, it, expect } from 'vitest';
import { decideAutoSeedAction } from '../lib/ui/demoWorkoutAutoSeed.svelte';
import { demoIntervalWorkout, DEMO_ROUTE_ID } from '../lib/data/demoWorkout';
import type { StructuredWorkout } from '../lib/types/index';

const OTHER_WORKOUT: StructuredWorkout = {
  id: 'other',
  name: 'Not the demo',
  description: '',
  type: 'intervals',
  segments: [],
  totalDuration: 0,
  targetMetric: 'pace',
  createdAt: new Date(0),
};

describe('decideAutoSeedAction (#472 FR3 + FR5 + FR6)', () => {
  it('AC3: guest on the demo route with an empty workout slot seeds', () => {
    expect(
      decideAutoSeedAction({
        activeRouteId: DEMO_ROUTE_ID,
        isAuthenticated: false,
        currentWorkout: null,
        seeded: false,
      }),
    ).toEqual({ kind: 'seed' });
  });

  it('AC5(i): guest on a non-demo route does nothing', () => {
    expect(
      decideAutoSeedAction({
        activeRouteId: '42',
        isAuthenticated: false,
        currentWorkout: null,
        seeded: false,
      }),
    ).toEqual({ kind: 'none' });
  });

  it('AC5(ii): a signed-in rower on the demo route does nothing', () => {
    expect(
      decideAutoSeedAction({
        activeRouteId: DEMO_ROUTE_ID,
        isAuthenticated: true,
        currentWorkout: null,
        seeded: false,
      }),
    ).toEqual({ kind: 'none' });
  });

  it('AC5(iii): a non-null `currentWorkout` is never overwritten — covers the Playwright-injected case', () => {
    expect(
      decideAutoSeedAction({
        activeRouteId: DEMO_ROUTE_ID,
        isAuthenticated: false,
        currentWorkout: OTHER_WORKOUT,
        seeded: false,
      }),
    ).toEqual({ kind: 'none' });
  });

  it('AC6: a guest signing in while the placeholder is active clears', () => {
    expect(
      decideAutoSeedAction({
        activeRouteId: DEMO_ROUTE_ID,
        isAuthenticated: true,
        currentWorkout: demoIntervalWorkout,
        seeded: true,
      }),
    ).toEqual({ kind: 'clear' });
  });

  it('a signed-in rower who never saw the placeholder is left alone', () => {
    expect(
      decideAutoSeedAction({
        activeRouteId: DEMO_ROUTE_ID,
        isAuthenticated: true,
        currentWorkout: null,
        seeded: false,
      }),
    ).toEqual({ kind: 'none' });
  });

  it('does not re-seed after the placeholder was manually replaced', () => {
    // Guest navigated away, workout cleared externally — don't boomerang.
    expect(
      decideAutoSeedAction({
        activeRouteId: DEMO_ROUTE_ID,
        isAuthenticated: false,
        currentWorkout: OTHER_WORKOUT,
        seeded: true,
      }),
    ).toEqual({ kind: 'none' });
  });
});
