import { describe, it, expect, beforeEach } from 'vitest';
import { workoutService } from '../services/workoutService';
import type { WorkoutSession } from '../types/index';

/**
 * Issue #337 — "your best on this route", which is not the same as your best.
 *
 * `getStats().bestPace` is the quickest average pace across every session the
 * rower has ever done, on any route. Held up beside a row on the Willowbrook
 * it compares a 500 m sprint with a 5 km paddle and calls the paddle a
 * failure. The summary needs the best on the route just rowed.
 */
/** Push straight into the service's history; there is no public adder. */
const addTo = (s: WorkoutSession) =>
  (workoutService as unknown as { sessions: WorkoutSession[] }).sessions.push(s);

const session = (over: Partial<WorkoutSession>): WorkoutSession =>
  ({
    id: Math.random().toString(36),
    routeId: 'willowbrook',
    routeName: 'Willowbrook River',
    startTime: new Date(),
    duration: 600,
    distance: 2000,
    averagePace: 120,
    calories: 100,
    samples: [],
    splits: [],
    isActive: false,
    ...over,
  }) as WorkoutSession;

describe('the best on a route', () => {
  beforeEach(() => {
    // The service is a module-scope singleton, so each case starts from an
    // empty history rather than whatever the last one left behind.
    for (const s of workoutService.getAllSessions().slice()) workoutService.deleteSession(s.id);
  });

  it('is nothing before the rower has rowed it', () => {
    expect(workoutService.bestPaceForRoute('willowbrook')).toBeNull();
  });

  it('is the quickest average pace on that route', () => {
    addTo(session({ averagePace: 125 }));
    addTo(session({ averagePace: 118 }));
    addTo(session({ averagePace: 130 }));

    expect(workoutService.bestPaceForRoute('willowbrook')).toBe(118);
  });

  it('does not count another route', () => {
    addTo(session({ averagePace: 100, routeId: 'tideway' }));
    addTo(session({ averagePace: 125 }));

    expect(workoutService.bestPaceForRoute('willowbrook')).toBe(125);
  });

  // A guest row is not kept and a demo row is not rowed. Neither is a best.
  it('does not count a guest row', () => {
    addTo(session({ averagePace: 90, isGuest: true }));
    addTo(session({ averagePace: 125 }));

    expect(workoutService.bestPaceForRoute('willowbrook')).toBe(125);
  });

  it('does not count a row still in progress', () => {
    addTo(session({ averagePace: 90, isActive: true }));
    addTo(session({ averagePace: 125 }));

    expect(workoutService.bestPaceForRoute('willowbrook')).toBe(125);
  });

  // A row that recorded no pace stored a zero, which would otherwise be a
  // record nobody can beat.
  it('does not count a row that recorded no pace', () => {
    addTo(session({ averagePace: 0 }));
    addTo(session({ averagePace: 125 }));

    expect(workoutService.bestPaceForRoute('willowbrook')).toBe(125);
  });

  it('can be told to ignore the row just finished', () => {
    const today = session({ averagePace: 110 });
    addTo(session({ averagePace: 125 }));
    addTo(today);

    expect(workoutService.bestPaceForRoute('willowbrook', { excludeId: today.id })).toBe(125);
  });
});
