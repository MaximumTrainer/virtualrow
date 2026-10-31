/**
 * The decision function behind the demo-route auto-seed effect (#472 Phase 2).
 *
 * A guest who lands on the Willowbrook demo route gets the bundled
 * `demoIntervalWorkout` seeded into `CurrentWorkoutStore` so `WorkoutBlockPanel`
 * paints the block-image on the first frame (FR3). The checks around that seed
 * — don't seed on another route, don't seed for a signed-in rower, don't
 * stomp an injected test workout, and clear once the guest signs in — are
 * written here as a pure function so every negative case (FR5, FR6) is
 * covered by a Vitest unit rather than a Svelte $effect harness.
 */
import type { StructuredWorkout } from '../types';
import { DEMO_ROUTE_ID } from '../data/demoWorkout';

export interface AutoSeedInputs {
  /** The id of the route currently selected by `RoutesStore`. */
  activeRouteId: string | null;
  /** `AuthStore.isAuthenticated` at the moment of the tick. */
  isAuthenticated: boolean;
  /** `CurrentWorkoutStore.current` at the moment of the tick. */
  currentWorkout: StructuredWorkout | null;
  /** `true` once this call-site has seeded the placeholder and not cleared it. */
  seeded: boolean;
}

export type AutoSeedAction = { kind: 'none' } | { kind: 'seed' } | { kind: 'clear' };

/**
 * Decide what the auto-seed effect should do on a given state tick.
 *
 * - Returns `{ kind: 'clear' }` when a previously-seeded placeholder must be
 *   cleared because the guest has signed in (FR6).
 * - Returns `{ kind: 'seed' }` when all of the FR3 pre-conditions hold: guest
 *   session, demo route selected, and the current workout slot is empty (which
 *   also handles FR5(iii) — a Playwright-injected workout wins because
 *   `currentWorkout` is already non-null).
 * - Returns `{ kind: 'none' }` otherwise.
 */
export function decideAutoSeedAction(inputs: AutoSeedInputs): AutoSeedAction {
  const { activeRouteId, isAuthenticated, currentWorkout, seeded } = inputs;

  if (isAuthenticated) {
    return seeded ? { kind: 'clear' } : { kind: 'none' };
  }
  if (activeRouteId !== DEMO_ROUTE_ID) return { kind: 'none' };
  if (currentWorkout !== null) return { kind: 'none' };
  return { kind: 'seed' };
}

export { DEMO_ROUTE_ID };
