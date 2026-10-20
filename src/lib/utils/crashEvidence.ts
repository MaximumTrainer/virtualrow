// ============================================================================
// DID THE RENDERER DIE, AND WOULD ANYONE KNOW?
//
// A spec whose renderer dies can still pass. Twenty-six of the twenty-eight
// specs under playwright/tests/ never ask, and the two that do would have
// missed the one crash this repository has actually seen: #301's tab death
// raised no `crash` event at all. The browser killed the renderer and restored
// the tab, and to Playwright that looks like a navigation —
// "Execution context was destroyed, most likely because of a navigation".
//
// There is a second signal, and it outlives the process. telemetryBoot records
// `page-hide` when the tab goes away tidily, and openTelemetry appends a
// `run-start` on every load, into sessionStorage — which survives a reload of
// the same tab. So a tab that came back without saying goodbye reloaded for a
// reason nobody chose.
//
// A pure function, like describeSceneHealth, so the rule is testable without a
// browser and cannot drift from the guard that applies it.
// ============================================================================

import type { TelemetryEvent } from './sceneTelemetryLog';

export interface CrashObservation {
  /** Whether Playwright's `page.on('crash')` fired during the test. */
  crashEventFired: boolean;
  /** The scene telemetry log, oldest first, as it stood before teardown. */
  events: TelemetryEvent[];
}

export interface CrashVerdict {
  crashed: boolean;
  reason: string;
}

/** A tidy exit writes this before the tab goes. */
const PAGE_HIDE = 'page-hide';

/** Every load appends this, carrying how much of the previous run it recovered. */
const RUN_START = 'run-start';

/**
 * Whether the page under a test died, and how it can be told.
 *
 * Silence is the default. Specs such as auth.spec.ts never start a scene, so an
 * empty log is the normal state of a page that simply never got there — a guard
 * that failed those would be removed within the week.
 */
export const describeCrashEvidence = ({
  crashEventFired,
  events,
}: CrashObservation): CrashVerdict => {
  if (crashEventFired) {
    return { crashed: true, reason: 'the renderer process crashed' };
  }

  if (events.length === 0) {
    return { crashed: false, reason: 'no telemetry was recorded' };
  }

  const runStartIndices = events
    .map((event, index) => (event.kind === RUN_START ? index : -1))
    .filter((index) => index >= 0);

  if (runStartIndices.length < 2) {
    return { crashed: false, reason: 'one run, and nothing says it ended badly' };
  }

  // Every reload is judged, not only the last one. A test that reloads tidily
  // and is then killed would otherwise be read by its tidy reload alone.
  for (let i = 1; i < runStartIndices.length; i += 1) {
    const previous = runStartIndices[i - 1];
    const current = runStartIndices[i];
    const saidGoodbye = events
      .slice(previous, current)
      .some((event) => event.kind === PAGE_HIDE);

    if (!saidGoodbye) {
      return {
        crashed: true,
        reason:
          'the page reloaded without a page-hide: the renderer was killed and the tab restored',
      };
    }
  }

  return { crashed: false, reason: 'the page reloaded tidily' };
};
