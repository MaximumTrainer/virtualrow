<!--
  LoadTodaysWorkoutButton — load a planned intervals.icu workout (#542 P1, port
  of LoadTodaysWorkoutButton.tsx, issue #445 FR2/FR3).

  Renders, for a signed-in athlete, a "Load today's workout" button that fetches
  today's first rowing event and hands it back through `onLoad`, plus a date
  input (today ± 14 days) that lists the matches on another day. Guests see
  nothing (the Row screen only mounts this when authenticated). The React
  hooks become local `$state` and plain async functions; markup, class names
  and copy are kept verbatim.
-->
<script lang="ts">
  import type { StructuredWorkout, WorkoutPlan } from '../types/index';
  import type { AuthPort, IntervalsIcuWorkoutPort } from '../ports';
  import { IntervalsWorkoutFetchError } from '../services/intervalsIcuWorkoutService';

  interface Props {
    authService: AuthPort;
    intervalsIcuWorkoutService: IntervalsIcuWorkoutPort;
    athleteId: string;
    /** Called once a workout is loaded and ready to start. */
    onLoad: (workout: StructuredWorkout) => void;
    /** Optional clock override so tests can pin "today". Defaults to `new Date()`. */
    now?: () => Date;
  }

  let {
    authService,
    intervalsIcuWorkoutService,
    athleteId,
    onLoad,
    now = () => new Date(),
  }: Props = $props();

  /** ±14 days per the issue's search window (D2(a)). */
  const SEARCH_WINDOW_DAYS = 14;

  const formatDate = (date: Date): string => date.toISOString().slice(0, 10);

  const startOfDay = (date: Date): Date => {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    return d;
  };

  const addDays = (date: Date, days: number): Date => {
    const d = new Date(date);
    d.setDate(d.getDate() + days);
    return d;
  };

  /** ISO-date-only comparison against a plan's scheduledDate. */
  const planIsOnDate = (plan: WorkoutPlan, isoDate: string): boolean => {
    if (!plan.scheduledDate) return false;
    return plan.scheduledDate.slice(0, 10) === isoDate;
  };

  /** Order plans by their scheduled time, ties broken by fetch order (D1(a)). */
  const byScheduledTime = (a: WorkoutPlan, b: WorkoutPlan): number => {
    if (!a.scheduledDate && !b.scheduledDate) return 0;
    if (!a.scheduledDate) return 1;
    if (!b.scheduledDate) return -1;
    return a.scheduledDate.localeCompare(b.scheduledDate);
  };

  let status = $state<'idle' | 'loading' | 'error' | 'searching'>('idle');
  let error = $state<string | null>(null);
  let searchDate = $state('');
  let searchResults = $state<WorkoutPlan[]>([]);

  const dateBounds = $derived.by(() => {
    const today = startOfDay(now());
    return {
      min: formatDate(addDays(today, -SEARCH_WINDOW_DAYS)),
      max: formatDate(addDays(today, SEARCH_WINDOW_DAYS)),
      today: formatDate(today),
    };
  });

  /**
   * Fetch planned rowing workouts within `daysAhead` days, refreshing the
   * access token once on a 401 (FR2).
   */
  async function fetchWithRefresh(daysAhead: number): Promise<WorkoutPlan[]> {
    const attempt = async (): Promise<WorkoutPlan[]> => {
      const token = authService.getAccessToken();
      if (!token) throw new IntervalsWorkoutFetchError('Signed out.', 401);
      return intervalsIcuWorkoutService.fetchPlannedRowingWorkouts(token, athleteId, daysAhead);
    };
    try {
      return await attempt();
    } catch (err) {
      if (err instanceof IntervalsWorkoutFetchError && err.status === 401) {
        const refreshed = await authService.refreshAccessToken();
        if (!refreshed) throw err;
        return await attempt();
      }
      throw err;
    }
  }

  async function handleLoadToday() {
    status = 'loading';
    error = null;
    try {
      const plans = await fetchWithRefresh(1);
      const todaysPlans = plans.filter((p) => planIsOnDate(p, dateBounds.today));
      const sorted = [...todaysPlans].sort(byScheduledTime);
      const first = sorted[0];
      if (!first) {
        status = 'error';
        error = 'No rowing workout scheduled for today.';
        return;
      }
      onLoad(intervalsIcuWorkoutService.toStructuredWorkout(first));
      status = 'idle';
    } catch (err) {
      status = 'error';
      error = err instanceof Error ? err.message : "Could not load today's workout.";
    }
  }

  async function handleSearchDate(isoDate: string) {
    searchDate = isoDate;
    searchResults = [];
    error = null;
    if (!isoDate) return;
    status = 'searching';
    try {
      const plans = await fetchWithRefresh(SEARCH_WINDOW_DAYS);
      const onDay = plans.filter((p) => planIsOnDate(p, isoDate)).sort(byScheduledTime);
      searchResults = onDay;
      status = 'idle';
      if (onDay.length === 0) {
        error = 'No rowing workout scheduled for that day.';
      }
    } catch (err) {
      status = 'error';
      error = err instanceof Error ? err.message : 'Could not search planned workouts.';
    }
  }

  function handlePickResult(plan: WorkoutPlan) {
    onLoad(intervalsIcuWorkoutService.toStructuredWorkout(plan));
    searchResults = [];
    searchDate = '';
    error = null;
    status = 'idle';
  }
</script>

<div class="load-todays-workout">
  <button
    type="button"
    class="btn btn-load-todays-workout"
    onclick={handleLoadToday}
    disabled={status === 'loading'}
  >
    {status === 'loading' ? 'Loading…' : "Load today's workout"}
  </button>

  <label class="load-todays-workout-search">
    <span>Search another day</span>
    <input
      type="date"
      min={dateBounds.min}
      max={dateBounds.max}
      value={searchDate}
      onchange={(e) => void handleSearchDate((e.currentTarget as HTMLInputElement).value)}
      disabled={status === 'searching'}
    />
  </label>

  {#if searchResults.length > 0}
    <ul class="load-todays-workout-results" aria-label="Matching workouts">
      {#each searchResults as plan (plan.id)}
        <li>
          <button
            type="button"
            class="btn btn-load-planned-workout"
            onclick={() => handlePickResult(plan)}
          >
            {plan.name}{plan.summary ? ` — ${plan.summary}` : ''}
          </button>
        </li>
      {/each}
    </ul>
  {/if}

  {#if error}
    <p class="load-todays-workout-error" role="alert">
      {error}
    </p>
  {/if}
</div>
