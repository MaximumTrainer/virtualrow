import { render, fireEvent, waitFor } from '@testing-library/svelte';
import { describe, it, expect, vi } from 'vitest';

import LoadTodaysWorkoutButton from '../lib/ui/LoadTodaysWorkoutButton.svelte';
import { IntervalsWorkoutFetchError } from '../lib/services/intervalsIcuWorkoutService';
import type { AuthPort, IntervalsIcuWorkoutPort } from '../lib/ports';
import type { StructuredWorkout, WorkoutPlan } from '../lib/types/index';

const TODAY = '2026-03-15';
const now = () => new Date(`${TODAY}T08:00:00Z`);

function plan(id: string, name: string, isoDate: string, summary = ''): WorkoutPlan {
  return {
    id,
    name,
    summary,
    scheduledDate: `${isoDate}T06:00:00Z`,
    source: 'intervals.icu',
    blocks: [],
    totalDurationSec: 1200,
  };
}

function structured(id: string): StructuredWorkout {
  return {
    id,
    name: `workout-${id}`,
    description: '',
    type: 'steady-state',
    segments: [],
    totalDuration: 1200,
    targetMetric: 'pace',
    createdAt: new Date(0),
  };
}

function ports(overrides: {
  token?: string | null;
  plans?: WorkoutPlan[];
  fetch?: IntervalsIcuWorkoutPort['fetchPlannedRowingWorkouts'];
  refresh?: () => Promise<boolean>;
}) {
  const auth = {
    getAccessToken: vi.fn(() => overrides.token ?? 'tok'),
    refreshAccessToken: vi.fn(overrides.refresh ?? (async () => true)),
  } as unknown as AuthPort;
  const workout = {
    fetchPlannedRowingWorkouts: vi.fn(overrides.fetch ?? (async () => overrides.plans ?? [])),
    toStructuredWorkout: vi.fn((p: WorkoutPlan) => structured(p.id)),
  } as unknown as IntervalsIcuWorkoutPort;
  return { auth, workout };
}

describe('LoadTodaysWorkoutButton.svelte', () => {
  it("loads today's first rowing workout and calls onLoad", async () => {
    const { auth, workout } = ports({ plans: [plan('a', 'Row A', TODAY)] });
    const onLoad = vi.fn();
    const { getByRole } = render(LoadTodaysWorkoutButton, {
      authService: auth,
      intervalsIcuWorkoutService: workout,
      athleteId: 'me',
      onLoad,
      now,
    });

    await fireEvent.click(getByRole('button', { name: "Load today's workout" }));
    await waitFor(() => expect(onLoad).toHaveBeenCalledTimes(1));
    expect(onLoad.mock.calls[0][0]).toMatchObject({ id: 'a' });
  });

  it('shows an error when nothing is scheduled for today', async () => {
    const { auth, workout } = ports({ plans: [plan('b', 'Row B', '2026-03-16')] });
    const { getByRole, findByRole } = render(LoadTodaysWorkoutButton, {
      authService: auth,
      intervalsIcuWorkoutService: workout,
      athleteId: 'me',
      onLoad: vi.fn(),
      now,
    });

    await fireEvent.click(getByRole('button', { name: "Load today's workout" }));
    const alert = await findByRole('alert');
    expect(alert.textContent).toContain('No rowing workout scheduled for today.');
  });

  it('refreshes the token once on a 401 and retries', async () => {
    let calls = 0;
    const fetchFn = vi.fn(async () => {
      calls += 1;
      if (calls === 1) throw new IntervalsWorkoutFetchError('Unauthorized', 401);
      return [plan('c', 'Row C', TODAY)];
    });
    const refresh = vi.fn(async () => true);
    const { auth, workout } = ports({ fetch: fetchFn, refresh });
    const onLoad = vi.fn();
    const { getByRole } = render(LoadTodaysWorkoutButton, {
      authService: auth,
      intervalsIcuWorkoutService: workout,
      athleteId: 'me',
      onLoad,
      now,
    });

    await fireEvent.click(getByRole('button', { name: "Load today's workout" }));
    await waitFor(() => expect(onLoad).toHaveBeenCalledTimes(1));
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('lists matches for a searched day and loads a picked one', async () => {
    const { auth, workout } = ports({
      plans: [plan('d', 'Row D', '2026-03-20', 'easy'), plan('e', 'Row E', '2026-03-21')],
    });
    const onLoad = vi.fn();
    const { container, getByRole } = render(LoadTodaysWorkoutButton, {
      authService: auth,
      intervalsIcuWorkoutService: workout,
      athleteId: 'me',
      onLoad,
      now,
    });

    const dateInput = container.querySelector('input[type="date"]') as HTMLInputElement;
    await fireEvent.change(dateInput, { target: { value: '2026-03-20' } });

    const pick = await waitFor(() => getByRole('button', { name: /Row D/ }));
    expect(pick.textContent).toContain('Row D — easy');
    await fireEvent.click(pick);
    expect(onLoad).toHaveBeenCalledTimes(1);
    expect(onLoad.mock.calls[0][0]).toMatchObject({ id: 'd' });
  });

  it('reports a fetch failure', async () => {
    const fetchFn = vi.fn(async () => {
      throw new IntervalsWorkoutFetchError('boom', 500);
    });
    const { auth, workout } = ports({ fetch: fetchFn });
    const { getByRole, findByRole } = render(LoadTodaysWorkoutButton, {
      authService: auth,
      intervalsIcuWorkoutService: workout,
      athleteId: 'me',
      onLoad: vi.fn(),
      now,
    });

    await fireEvent.click(getByRole('button', { name: "Load today's workout" }));
    const alert = await findByRole('alert');
    expect(alert.textContent).toContain('boom');
  });
});
