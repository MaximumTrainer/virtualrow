import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LoadTodaysWorkoutButton } from '../components/LoadTodaysWorkoutButton';
import { IntervalsWorkoutFetchError } from '../services/intervalsIcuWorkoutService';
import type { AuthPort, IntervalsIcuWorkoutPort } from '../ports';
import type { StructuredWorkout, WorkoutPlan } from '../types/index';

const fixedNow = () => new Date('2026-09-30T09:00:00Z');

const plan = (over: Partial<WorkoutPlan> = {}): WorkoutPlan => ({
  id: 'p1',
  name: 'Tuesday intervals',
  summary: '4x4min',
  scheduledDate: '2026-09-30T07:00:00',
  source: 'intervals.icu',
  blocks: [],
  totalDurationSec: 1200,
  ...over,
});

const asWorkout = (p: WorkoutPlan): StructuredWorkout => ({
  id: `icu-plan-${p.id}`,
  name: p.name,
  description: '',
  type: 'intervals',
  segments: [],
  totalDuration: p.totalDurationSec,
  targetMetric: 'pace',
  createdAt: new Date(),
});

const services = (
  overrides: {
    fetchPlannedRowingWorkouts?: IntervalsIcuWorkoutPort['fetchPlannedRowingWorkouts'];
    getAccessToken?: AuthPort['getAccessToken'];
    refreshAccessToken?: AuthPort['refreshAccessToken'];
  } = {},
) => {
  const authService: AuthPort = {
    getAccessToken: overrides.getAccessToken ?? vi.fn(() => 'token'),
    refreshAccessToken: overrides.refreshAccessToken ?? vi.fn().mockResolvedValue(true),
    // Unused by the component; satisfy the port shape.
    startLogin: vi.fn(),
    handleCallback: vi.fn(),
    logout: vi.fn(),
    getUser: vi.fn(() => ({ id: 'i123' })),
    getLastError: vi.fn(() => null),
    scheduleRefresh: vi.fn(),
    isAuthenticated: vi.fn(() => true),
  } as unknown as AuthPort;
  const intervalsIcuWorkoutService: IntervalsIcuWorkoutPort = {
    fetchPlannedRowingWorkouts:
      overrides.fetchPlannedRowingWorkouts ?? vi.fn().mockResolvedValue([plan()]),
    toStructuredWorkout: vi.fn(asWorkout),
  };
  return { authService, intervalsIcuWorkoutService };
};

describe('LoadTodaysWorkoutButton (#445, AC2 / AC3 / AC4)', () => {
  it("loads today's first-by-time workout on click (AC2, D1(a))", async () => {
    const onLoad = vi.fn();
    const later = plan({ id: 'p2', scheduledDate: '2026-09-30T12:00:00' });
    const earlier = plan({ id: 'p1', scheduledDate: '2026-09-30T07:00:00' });
    const svc = services({
      fetchPlannedRowingWorkouts: vi.fn().mockResolvedValue([later, earlier]),
    });
    render(<LoadTodaysWorkoutButton {...svc} athleteId="i123" onLoad={onLoad} now={fixedNow} />);
    await userEvent.click(screen.getByRole('button', { name: /load today's workout/i }));
    await waitFor(() => expect(onLoad).toHaveBeenCalled());
    expect(svc.intervalsIcuWorkoutService.toStructuredWorkout).toHaveBeenCalledWith(earlier);
  });

  it('reports no workout when none is scheduled today', async () => {
    const svc = services({ fetchPlannedRowingWorkouts: vi.fn().mockResolvedValue([]) });
    const onLoad = vi.fn();
    render(<LoadTodaysWorkoutButton {...svc} athleteId="i123" onLoad={onLoad} now={fixedNow} />);
    await userEvent.click(screen.getByRole('button', { name: /load today's workout/i }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(onLoad).not.toHaveBeenCalled();
  });

  it('refreshes the token once on a 401 and retries (FR2)', async () => {
    let call = 0;
    const svc = services({
      fetchPlannedRowingWorkouts: vi.fn().mockImplementation(async () => {
        call += 1;
        if (call === 1) throw new IntervalsWorkoutFetchError('expired', 401);
        return [plan()];
      }),
    });
    const onLoad = vi.fn();
    render(<LoadTodaysWorkoutButton {...svc} athleteId="i123" onLoad={onLoad} now={fixedNow} />);
    await userEvent.click(screen.getByRole('button', { name: /load today's workout/i }));
    await waitFor(() => expect(onLoad).toHaveBeenCalled());
    expect(svc.authService.refreshAccessToken).toHaveBeenCalledTimes(1);
  });

  it('searches by date within ±14 days and offers matches to pick (AC3)', async () => {
    const p1 = plan({ id: 'p1', name: 'Wednesday piece', scheduledDate: '2026-10-01T09:00:00' });
    const p2 = plan({ id: 'p2', name: 'Elsewhere', scheduledDate: '2026-09-28T09:00:00' });
    const svc = services({
      fetchPlannedRowingWorkouts: vi.fn().mockResolvedValue([p1, p2]),
    });
    const onLoad = vi.fn();
    render(<LoadTodaysWorkoutButton {...svc} athleteId="i123" onLoad={onLoad} now={fixedNow} />);
    const dateInput = screen.getByLabelText(/search another day/i);
    await userEvent.type(dateInput, '2026-10-01');
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /wednesday piece/i })).toBeInTheDocument(),
    );
    // The other day's plan is not offered.
    expect(screen.queryByRole('button', { name: /elsewhere/i })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: /wednesday piece/i }));
    expect(onLoad).toHaveBeenCalled();
  });

  it('surfaces a fetch error to the rower', async () => {
    const svc = services({
      fetchPlannedRowingWorkouts: vi.fn().mockRejectedValue(new Error('network')),
    });
    render(
      <LoadTodaysWorkoutButton {...svc} athleteId="i123" onLoad={vi.fn()} now={fixedNow} />,
    );
    await userEvent.click(screen.getByRole('button', { name: /load today's workout/i }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/network/i));
  });
});
