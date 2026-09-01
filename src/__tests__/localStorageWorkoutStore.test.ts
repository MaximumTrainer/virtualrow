import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  clearSessions,
  loadSessions,
  markSessionUploaded,
  saveCompletedSession,
  saveSession,
} from '../services/localStorageWorkoutStore';
import type { WorkoutSession } from '../types/index';

/**
 * Local persistence for a finished row (issue #221, R6). `saveSession` had been
 * dead since it was written; these cover its first caller and the rule about
 * which rows belong in an athlete's history at all.
 */

const USER = 'i12345';

function makeSession(overrides: Partial<WorkoutSession> = {}): WorkoutSession {
  return {
    id: 's-1',
    routeId: 'r1',
    routeName: 'Willowbrook River',
    startTime: new Date('2026-03-14T08:00:00Z'),
    endTime: new Date('2026-03-14T08:21:14Z'),
    duration: 1274,
    distance: 5000,
    averagePace: 127,
    calories: 240,
    splits: [],
    isActive: false,
    samples: [{ t: 0, distance: 0 }],
    ...overrides,
  };
}

describe('localStorageWorkoutStore', () => {
  beforeEach(() => clearSessions(USER));
  afterEach(() => {
    clearSessions(USER);
    vi.restoreAllMocks();
  });

  it('persists a completed row for a signed-in athlete (AC6.1)', () => {
    saveCompletedSession(USER, makeSession(), { isDemo: false });

    const stored = loadSessions(USER);
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ id: 's-1', routeName: 'Willowbrook River', distance: 5000 });
    // Dates survive the round-trip, so history can be sorted and formatted.
    expect(stored[0].startTime).toBeInstanceOf(Date);
  });

  it('stores nothing for a guest row (AC6.4)', () => {
    saveCompletedSession(USER, makeSession({ isGuest: true }), { isDemo: false });
    expect(loadSessions(USER)).toEqual([]);
  });

  it('stores nothing for a demo row (AC6.4)', () => {
    saveCompletedSession(USER, makeSession(), { isDemo: true });
    expect(loadSessions(USER)).toEqual([]);
  });

  it('stores nothing when there is no signed-in athlete (AC6.4)', () => {
    saveCompletedSession('', makeSession(), { isDemo: false });
    expect(loadSessions('')).toEqual([]);
  });

  it('records the intervals.icu activity id against the stored row (AC6.2)', () => {
    saveCompletedSession(USER, makeSession(), { isDemo: false });
    markSessionUploaded(USER, 's-1', 'i9090');

    const [stored] = loadSessions(USER);
    expect(stored.uploadedActivityId).toBe('i9090');
  });

  it('leaves an unsaved row without an activity id (AC6.2)', () => {
    saveCompletedSession(USER, makeSession(), { isDemo: false });
    expect(loadSessions(USER)[0].uploadedActivityId).toBeUndefined();
  });

  it('ignores an upload for a row it never stored', () => {
    markSessionUploaded(USER, 'not-here', 'i1');
    expect(loadSessions(USER)).toEqual([]);
  });

  it('does not duplicate a row saved twice', () => {
    const session = makeSession();
    saveSession(USER, session);
    saveSession(USER, session);
    expect(loadSessions(USER)).toHaveLength(1);
  });

  it('warns and swallows a storage failure rather than blocking the summary (AC6.3)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('QuotaExceededError');
    });

    expect(() => saveCompletedSession(USER, makeSession(), { isDemo: false })).not.toThrow();
    expect(warn).toHaveBeenCalled();
  });

  it('keeps each athlete\'s rows separate', () => {
    saveCompletedSession(USER, makeSession(), { isDemo: false });
    saveCompletedSession('i999', makeSession({ id: 's-2' }), { isDemo: false });

    expect(loadSessions(USER).map((s) => s.id)).toEqual(['s-1']);
    expect(loadSessions('i999').map((s) => s.id)).toEqual(['s-2']);
    clearSessions('i999');
  });
});
