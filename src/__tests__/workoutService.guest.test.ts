import { describe, it, expect } from 'vitest';
import { WorkoutService } from '../services/workoutService';

describe('WorkoutService guest mode', () => {
  it('excludes guest sessions from getAllSessions()', () => {
    const svc = new WorkoutService();
    svc.startSession('r1', 'Normal Route');
    svc.endSession();

    svc.startSession('r2', 'Willowbrook River', undefined, undefined, undefined, true);
    svc.endSession();

    const sessions = svc.getAllSessions();
    expect(sessions).toHaveLength(1);
    expect(sessions[0].routeId).toBe('r1');
  });

  it('stores isGuest flag on the session', () => {
    const svc = new WorkoutService();
    const session = svc.startSession('r1', 'Willowbrook River', undefined, undefined, undefined, true);
    expect(session.isGuest).toBe(true);
  });

  it('normal sessions (no isGuest) are included in getAllSessions()', () => {
    const svc = new WorkoutService();
    svc.startSession('r1', 'Route A');
    svc.endSession();
    svc.startSession('r2', 'Route B');
    svc.endSession();
    expect(svc.getAllSessions()).toHaveLength(2);
  });

  it('getCurrentSession still returns a guest session while active', () => {
    const svc = new WorkoutService();
    svc.startSession('r1', 'Willowbrook River', undefined, undefined, undefined, true);
    expect(svc.getCurrentSession()?.isGuest).toBe(true);
    svc.endSession();
  });

  it('getStats excludes guest sessions', () => {
    const svc = new WorkoutService();
    svc.startSession('r1', 'Route A');
    svc.endSession();

    svc.startSession('r2', 'Willowbrook River', undefined, undefined, undefined, true);
    svc.endSession();

    const stats = svc.getStats();
    expect(stats.totalWorkouts).toBe(1);
  });
});
