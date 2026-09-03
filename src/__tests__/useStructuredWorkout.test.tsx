import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { ServicesProvider } from '../context/ServicesContext';
import type { Services, WorkoutGeneratorPort } from '../ports';
import { IntervalsWorkoutFetchError } from '../services/intervalsIcuWorkoutService';
import type { StructuredWorkout, WorkoutProgress, WorkoutSegment } from '../types/index';
import {
  useStructuredWorkout,
  SELECTED_WORKOUT_STORAGE_KEY,
} from '../hooks/useStructuredWorkout';

const segment = (over: Partial<WorkoutSegment> = {}): WorkoutSegment => ({
  id: 's1', order: 0, type: 'work', duration: 300, ...over,
});

const aWorkout = (over: Partial<StructuredWorkout> = {}): StructuredWorkout => ({
  id: 'w1',
  name: 'Steady 20',
  description: '',
  type: 'steady-state',
  segments: [segment()],
  totalDuration: 300,
  targetMetric: 'pace',
  createdAt: new Date(),
  ...over,
});

const progress = (over: Partial<WorkoutProgress> = {}): WorkoutProgress => ({
  workoutId: 'w1',
  currentSegmentIndex: 0,
  currentSegment: segment(),
  segmentElapsedTime: 0,
  segmentProgress: 0,
  totalElapsedTime: 0,
  totalProgress: 0,
  isOnTarget: true,
  deviationPercent: 0,
  ...over,
});

/** A generator port that records what the hook asked it to do. */
const stubPort = (over: Partial<WorkoutGeneratorPort> = {}) => {
  const workouts = [aWorkout(), aWorkout({ id: 'w2', name: 'Pyramid' })];
  const calls = { started: [] as string[], ended: 0, updates: 0 };
  const port = {
    getAllWorkouts: () => workouts,
    getWorkoutById: (id: string) => workouts.find((w) => w.id === id),
    addWorkout: vi.fn(),
    startWorkout: (id: string) => {
      calls.started.push(id);
      return progress({ workoutId: id });
    },
    endWorkout: () => { calls.ended++; },
    updateProgress: () => { calls.updates++; return progress({ totalProgress: 42 }); },
    getCurrentProgress: () => null,
    getCurrentWorkout: () => null,
    getExpandedCurrentSegments: () => [segment()],
    expandSegments: (s: WorkoutSegment[]) => s,
    getSpeedAdjustmentFactor: () => 0.8,
    resumeAfterGap: vi.fn(),
    importFromIntervalsICU: vi.fn(),
    ...over,
  } as unknown as WorkoutGeneratorPort;
  return { port, calls, workouts };
};

const wrap = (port: WorkoutGeneratorPort) =>
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <ServicesProvider services={{ workoutGeneratorService: port }}>{children}</ServicesProvider>
    );
  };

describe('useStructuredWorkout and the signed-in intervals.icu session', () => {
  const plan = { id: 'p1', name: 'Tuesday intervals', summary: '', source: 'intervals.icu' as const, blocks: [], totalDurationSec: 1200 };
  const planned = aWorkout({ id: 'icu-plan-p1', name: 'Tuesday intervals', source: 'intervals.icu' });

  const wrapWith = (
    port: WorkoutGeneratorPort,
    icu: Partial<Services['intervalsIcuWorkoutService']>,
    auth: Partial<Services['authService']>,
  ) =>
    function Wrapper({ children }: { children: ReactNode }) {
      return (
        <ServicesProvider
          services={{
            workoutGeneratorService: port,
            intervalsIcuWorkoutService: {
              fetchPlannedRowingWorkouts: vi.fn().mockResolvedValue([plan]),
              toStructuredWorkout: () => planned,
              ...icu,
            } as Services['intervalsIcuWorkoutService'],
            authService: {
              getUser: () => ({ id: 'i123', name: 'Rower', email: 'r@example.com' }),
              getAccessToken: () => 'token',
              refreshAccessToken: vi.fn().mockResolvedValue(true),
              ...auth,
            } as unknown as Services['authService'],
          }}
        >
          {children}
        </ServicesProvider>
      );
    };

  beforeEach(() => {
    localStorage.clear();
  });

  it('knows the session can be used when signed in with a token', () => {
    const { port } = stubPort();
    const { result } = renderHook(() => useStructuredWorkout(), {
      wrapper: wrapWith(port, {}, {}),
    });
    expect(result.current.canUseIntervalsIcuSession).toBe(true);
  });

  it('does not offer the session without a token', () => {
    const { port } = stubPort();
    const { result } = renderHook(() => useStructuredWorkout(), {
      wrapper: wrapWith(port, {}, { getAccessToken: () => null }),
    });
    expect(result.current.canUseIntervalsIcuSession).toBe(false);
  });

  it('loads the calendar with the session, asking for no credentials', async () => {
    const fetchPlanned = vi.fn().mockResolvedValue([plan]);
    const { port } = stubPort();
    const { result } = renderHook(() => useStructuredWorkout(), {
      wrapper: wrapWith(port, { fetchPlannedRowingWorkouts: fetchPlanned }, {}),
    });

    await act(async () => {
      await result.current.loadPlannedWorkouts();
    });

    expect(fetchPlanned).toHaveBeenCalledWith('token', 'i123', undefined);
    expect(result.current.plannedWorkouts).toHaveLength(1);
    expect(result.current.plannedError).toBeNull();
  });

  it('refreshes a stale token once and retries rather than blaming the rower', async () => {
    const fetchPlanned = vi
      .fn()
      .mockRejectedValueOnce(new IntervalsWorkoutFetchError('Unauthorized', 401))
      .mockResolvedValueOnce([plan]);
    const refreshAccessToken = vi.fn().mockResolvedValue(true);
    const { port } = stubPort();
    const { result } = renderHook(() => useStructuredWorkout(), {
      wrapper: wrapWith(port, { fetchPlannedRowingWorkouts: fetchPlanned }, { refreshAccessToken }),
    });

    await act(async () => {
      await result.current.loadPlannedWorkouts();
    });

    expect(refreshAccessToken).toHaveBeenCalledTimes(1);
    expect(fetchPlanned).toHaveBeenCalledTimes(2);
    expect(result.current.plannedWorkouts).toHaveLength(1);
    expect(result.current.plannedError).toBeNull();
  });

  it('gives up cleanly when the refresh cannot help', async () => {
    const fetchPlanned = vi
      .fn()
      .mockRejectedValue(new IntervalsWorkoutFetchError('Unauthorized', 401));
    const { port } = stubPort();
    const { result } = renderHook(() => useStructuredWorkout(), {
      wrapper: wrapWith(port, { fetchPlannedRowingWorkouts: fetchPlanned }, {
        refreshAccessToken: vi.fn().mockResolvedValue(false),
      }),
    });

    await act(async () => {
      await result.current.loadPlannedWorkouts();
    });

    expect(result.current.plannedError).toContain('Unauthorized');
    expect(result.current.plannedWorkouts).toEqual([]);
  });

  it('does not retry a failure a refresh cannot fix', async () => {
    const fetchPlanned = vi
      .fn()
      .mockRejectedValue(new IntervalsWorkoutFetchError('Unable to load planned workouts (500).', 500));
    const refreshAccessToken = vi.fn();
    const { port } = stubPort();
    const { result } = renderHook(() => useStructuredWorkout(), {
      wrapper: wrapWith(port, { fetchPlannedRowingWorkouts: fetchPlanned }, { refreshAccessToken }),
    });

    await act(async () => {
      await result.current.loadPlannedWorkouts();
    });

    expect(refreshAccessToken).not.toHaveBeenCalled();
    expect(fetchPlanned).toHaveBeenCalledTimes(1);
    expect(result.current.plannedError).toContain('(500)');
  });

  it('asks a signed-out rower to sign in rather than calling the API', async () => {
    const fetchPlanned = vi.fn();
    const { port } = stubPort();
    const { result } = renderHook(() => useStructuredWorkout(), {
      wrapper: wrapWith(port, { fetchPlannedRowingWorkouts: fetchPlanned }, { getUser: () => null }),
    });

    await act(async () => {
      await result.current.loadPlannedWorkouts();
    });

    expect(fetchPlanned).not.toHaveBeenCalled();
    expect(result.current.plannedError).toMatch(/sign in/i);
  });

  it('puts a chosen planned workout in the library and selects it', () => {
    const { port } = stubPort();
    const { result } = renderHook(() => useStructuredWorkout(), {
      wrapper: wrapWith(port, {}, {}),
    });

    act(() => result.current.addPlannedWorkout(planned));

    expect(port.addWorkout).toHaveBeenCalledWith(planned);
    expect(localStorage.getItem(SELECTED_WORKOUT_STORAGE_KEY)).toBe('icu-plan-p1');
  });
});

describe('useStructuredWorkout and a dropped ergometer', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('tells the workout to discount the gap when the device comes back', () => {
    const { port } = stubPort();
    const { rerender } = renderHook(
      ({ connected }: { connected: boolean }) => useStructuredWorkout(connected),
      { wrapper: wrap(port), initialProps: { connected: true } },
    );

    rerender({ connected: false });
    expect(port.resumeAfterGap).not.toHaveBeenCalled();

    rerender({ connected: true });
    expect(port.resumeAfterGap).toHaveBeenCalledTimes(1);
  });

  it('says nothing while the device stays connected', () => {
    const { port } = stubPort();
    const { rerender } = renderHook(
      ({ connected }: { connected: boolean }) => useStructuredWorkout(connected),
      { wrapper: wrap(port), initialProps: { connected: true } },
    );

    rerender({ connected: true });
    rerender({ connected: true });
    expect(port.resumeAfterGap).not.toHaveBeenCalled();
  });

  it('does not treat the first render as a reconnection', () => {
    const { port } = stubPort();
    renderHook(() => useStructuredWorkout(true), { wrapper: wrap(port) });
    expect(port.resumeAfterGap).not.toHaveBeenCalled();
  });
});

describe('useStructuredWorkout', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('offers the library and selects nothing by default', () => {
    const { port } = stubPort();
    const { result } = renderHook(() => useStructuredWorkout(), { wrapper: wrap(port) });

    expect(result.current.library).toHaveLength(2);
    expect(result.current.selected).toBeNull();
    expect(result.current.progress).toBeNull();
  });

  it('remembers the selected workout across sessions', () => {
    const { port } = stubPort();
    const { result } = renderHook(() => useStructuredWorkout(), { wrapper: wrap(port) });

    act(() => result.current.select('w2'));
    expect(result.current.selected?.name).toBe('Pyramid');
    expect(localStorage.getItem(SELECTED_WORKOUT_STORAGE_KEY)).toBe('w2');

    const { result: reopened } = renderHook(() => useStructuredWorkout(), { wrapper: wrap(port) });
    expect(reopened.current.selected?.id).toBe('w2');
  });

  it('forgets a remembered id that no longer exists', () => {
    localStorage.setItem(SELECTED_WORKOUT_STORAGE_KEY, 'gone');
    const { port } = stubPort();
    const { result } = renderHook(() => useStructuredWorkout(), { wrapper: wrap(port) });
    expect(result.current.selected).toBeNull();
  });

  it('clears the selection when asked', () => {
    const { port } = stubPort();
    const { result } = renderHook(() => useStructuredWorkout(), { wrapper: wrap(port) });

    act(() => result.current.select('w1'));
    act(() => result.current.select(null));
    expect(result.current.selected).toBeNull();
    expect(localStorage.getItem(SELECTED_WORKOUT_STORAGE_KEY)).toBeNull();
  });

  it('starts the selected workout and reports its first progress', () => {
    const { port, calls } = stubPort();
    const { result } = renderHook(() => useStructuredWorkout(), { wrapper: wrap(port) });

    act(() => result.current.select('w2'));
    act(() => {
      result.current.start();
    });

    expect(calls.started).toEqual(['w2']);
    expect(result.current.progress?.workoutId).toBe('w2');
    expect(result.current.isRunning).toBe(true);
  });

  it('refuses to start a workout that can never complete, and says why', () => {
    const unbounded = aWorkout({ id: 'bad', segments: [segment({ duration: undefined })] });
    const { port, calls } = stubPort({
      getAllWorkouts: () => [unbounded],
      getWorkoutById: () => unbounded,
    });
    const { result } = renderHook(() => useStructuredWorkout(), { wrapper: wrap(port) });

    act(() => result.current.select('bad'));
    let started: boolean | undefined;
    act(() => {
      started = result.current.start();
    });

    expect(started).toBe(false);
    expect(calls.started).toEqual([]);
    expect(result.current.isRunning).toBe(false);
    expect(result.current.validationErrors[0]).toMatch(/neither a duration nor a distance/i);
  });

  it('does nothing on start when no workout is selected', () => {
    const { port, calls } = stubPort();
    const { result } = renderHook(() => useStructuredWorkout(), { wrapper: wrap(port) });

    let started: boolean | undefined;
    act(() => {
      started = result.current.start();
    });
    expect(started).toBe(false);
    expect(calls.started).toEqual([]);
  });

  it('feeds live rower data through to progress', () => {
    const { port, calls } = stubPort();
    const { result } = renderHook(() => useStructuredWorkout(), { wrapper: wrap(port) });

    act(() => result.current.select('w1'));
    act(() => {
      result.current.start();
    });
    act(() => result.current.tick({ distance: 100, elapsedTime: 30_000, pace: 120 }));

    expect(calls.updates).toBe(1);
    expect(result.current.progress?.totalProgress).toBe(42);
  });

  it('ignores rower data when no workout is running', () => {
    const { port, calls } = stubPort();
    const { result } = renderHook(() => useStructuredWorkout(), { wrapper: wrap(port) });

    act(() => result.current.tick({ distance: 100, elapsedTime: 1000 }));
    expect(calls.updates).toBe(0);
  });

  it('stops cleanly and tells the service to end', () => {
    const { port, calls } = stubPort();
    const { result } = renderHook(() => useStructuredWorkout(), { wrapper: wrap(port) });

    act(() => result.current.select('w1'));
    act(() => {
      result.current.start();
    });
    act(() => result.current.stop());

    expect(calls.ended).toBe(1);
    expect(result.current.isRunning).toBe(false);
    expect(result.current.progress).toBeNull();
  });

  it('stops itself once the final segment completes', async () => {
    const { port, calls } = stubPort({
      updateProgress: () => progress({ isComplete: true, totalProgress: 100 }),
    });
    const { result } = renderHook(() => useStructuredWorkout(), { wrapper: wrap(port) });

    act(() => result.current.select('w1'));
    act(() => {
      result.current.start();
    });
    act(() => result.current.tick({ distance: 5000, elapsedTime: 300_000 }));

    await waitFor(() => expect(result.current.isComplete).toBe(true));
    expect(result.current.isRunning).toBe(false);
    expect(calls.ended).toBe(1);
    // The finished progress stays readable so the overlay can show the result.
    expect(result.current.progress?.totalProgress).toBe(100);
  });

  it('exposes the running workout segments, and none when idle', () => {
    const { port } = stubPort();
    const { result } = renderHook(() => useStructuredWorkout(), { wrapper: wrap(port) });

    expect(result.current.segments).toEqual([]);
    act(() => result.current.select('w1'));
    act(() => {
      result.current.start();
    });
    expect(result.current.segments).toHaveLength(1);
  });

  it('passes the segment intensity through as a 3D speed factor', () => {
    const { port } = stubPort();
    const { result } = renderHook(() => useStructuredWorkout(), { wrapper: wrap(port) });

    expect(result.current.speedFactor).toBeUndefined();
    act(() => result.current.select('w1'));
    act(() => {
      result.current.start();
    });
    expect(result.current.speedFactor).toBe(0.8);
  });

  it('adds an imported workout to the library and selects it', async () => {
    const imported = aWorkout({ id: 'icu-9', name: 'Imported', source: 'intervals.icu' });
    const { port } = stubPort({ importFromIntervalsICU: vi.fn().mockResolvedValue(imported) });
    const { result } = renderHook(() => useStructuredWorkout(), { wrapper: wrap(port) });

    let outcome: { ok: boolean; error?: string } | undefined;
    await act(async () => {
      outcome = await result.current.importFromIntervalsIcu('key', '123', '9');
    });

    expect(outcome?.ok).toBe(true);
    expect(port.importFromIntervalsICU).toHaveBeenCalledWith('key', '123', '9');
  });

  it('reports an import that returned nothing as a failure, without throwing', async () => {
    const { port } = stubPort({ importFromIntervalsICU: vi.fn().mockResolvedValue(null) });
    const { result } = renderHook(() => useStructuredWorkout(), { wrapper: wrap(port) });

    let outcome: { ok: boolean; error?: string } | undefined;
    await act(async () => {
      outcome = await result.current.importFromIntervalsIcu('key', '123', '9');
    });

    expect(outcome?.ok).toBe(false);
    expect(outcome?.error).toBeTruthy();
  });

  it('turns a thrown import error into a message rather than a crash', async () => {
    const { port } = stubPort({
      importFromIntervalsICU: vi.fn().mockRejectedValue(new Error('401 Unauthorized')),
    });
    const { result } = renderHook(() => useStructuredWorkout(), { wrapper: wrap(port) });

    let outcome: { ok: boolean; error?: string } | undefined;
    await act(async () => {
      outcome = await result.current.importFromIntervalsIcu('bad', '123', '9');
    });

    expect(outcome?.ok).toBe(false);
    expect(outcome?.error).toContain('401');
  });
});
