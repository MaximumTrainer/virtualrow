/**
 * Load today's planned workout from intervals.icu (issue #445, FR2 / FR3).
 *
 * Renders two controls for a signed-in athlete:
 *   - a "Load today's workout" button that fetches today's first rowing
 *     event, converts it, and hands it back through {@link onLoad};
 *   - a date input (min = today − 14 days, max = today + 14 days) that lets
 *     the athlete pick a session on another day within the window, showing
 *     the matches in a small list from which one is loaded (FR3 / D2(a)).
 *
 * Guests (`accessToken` null) see nothing (FR7 / D7(a)).
 */
import { useCallback, useMemo, useState } from 'react';
import type { StructuredWorkout, WorkoutPlan } from '../types/index';
import type { AuthPort, IntervalsIcuWorkoutPort } from '../ports';
import { IntervalsWorkoutFetchError } from '../services/intervalsIcuWorkoutService';

export interface LoadTodaysWorkoutButtonProps {
  authService: AuthPort;
  intervalsIcuWorkoutService: IntervalsIcuWorkoutPort;
  athleteId: string;
  /** Called once a workout is loaded and ready to start. */
  onLoad: (workout: StructuredWorkout) => void;
  /**
   * Optional clock override so tests can pin "today". Defaults to
   * `new Date()`.
   */
  now?: () => Date;
}

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

export function LoadTodaysWorkoutButton({
  authService,
  intervalsIcuWorkoutService,
  athleteId,
  onLoad,
  now = () => new Date(),
}: LoadTodaysWorkoutButtonProps) {
  const [status, setStatus] = useState<'idle' | 'loading' | 'error' | 'searching'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [searchDate, setSearchDate] = useState<string>('');
  const [searchResults, setSearchResults] = useState<WorkoutPlan[]>([]);

  const dateBounds = useMemo(() => {
    const today = startOfDay(now());
    return {
      min: formatDate(addDays(today, -SEARCH_WINDOW_DAYS)),
      max: formatDate(addDays(today, SEARCH_WINDOW_DAYS)),
      today: formatDate(today),
    };
  }, [now]);

  /**
   * Fetch planned rowing workouts within `daysAhead` days, refreshing the
   * access token once on a 401 (FR2).
   */
  const fetchWithRefresh = useCallback(
    async (daysAhead: number): Promise<WorkoutPlan[]> => {
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
    },
    [authService, intervalsIcuWorkoutService, athleteId],
  );

  const handleLoadToday = useCallback(async () => {
    setStatus('loading');
    setError(null);
    try {
      const plans = await fetchWithRefresh(1);
      const todaysPlans = plans.filter((p) => planIsOnDate(p, dateBounds.today));
      const sorted = [...todaysPlans].sort(byScheduledTime);
      const first = sorted[0];
      if (!first) {
        setStatus('error');
        setError('No rowing workout scheduled for today.');
        return;
      }
      onLoad(intervalsIcuWorkoutService.toStructuredWorkout(first));
      setStatus('idle');
    } catch (err) {
      setStatus('error');
      setError(err instanceof Error ? err.message : 'Could not load today\'s workout.');
    }
  }, [fetchWithRefresh, dateBounds.today, intervalsIcuWorkoutService, onLoad]);

  const handleSearchDate = useCallback(async (isoDate: string) => {
    setSearchDate(isoDate);
    setSearchResults([]);
    setError(null);
    if (!isoDate) return;
    setStatus('searching');
    try {
      const plans = await fetchWithRefresh(SEARCH_WINDOW_DAYS);
      const onDay = plans.filter((p) => planIsOnDate(p, isoDate)).sort(byScheduledTime);
      setSearchResults(onDay);
      setStatus('idle');
      if (onDay.length === 0) {
        setError('No rowing workout scheduled for that day.');
      }
    } catch (err) {
      setStatus('error');
      setError(err instanceof Error ? err.message : 'Could not search planned workouts.');
    }
  }, [fetchWithRefresh]);

  const handlePickResult = useCallback((plan: WorkoutPlan) => {
    onLoad(intervalsIcuWorkoutService.toStructuredWorkout(plan));
    setSearchResults([]);
    setSearchDate('');
    setError(null);
    setStatus('idle');
  }, [intervalsIcuWorkoutService, onLoad]);

  return (
    <div className="load-todays-workout">
      <button
        type="button"
        className="btn btn-load-todays-workout"
        onClick={handleLoadToday}
        disabled={status === 'loading'}
      >
        {status === 'loading' ? 'Loading…' : "Load today's workout"}
      </button>

      <label className="load-todays-workout-search">
        <span>Search another day</span>
        <input
          type="date"
          min={dateBounds.min}
          max={dateBounds.max}
          value={searchDate}
          onChange={(e) => void handleSearchDate(e.target.value)}
          disabled={status === 'searching'}
        />
      </label>

      {searchResults.length > 0 && (
        <ul className="load-todays-workout-results" aria-label="Matching workouts">
          {searchResults.map((plan) => (
            <li key={plan.id}>
              <button
                type="button"
                className="btn btn-load-planned-workout"
                onClick={() => handlePickResult(plan)}
              >
                {plan.name}
                {plan.summary ? ` — ${plan.summary}` : ''}
              </button>
            </li>
          ))}
        </ul>
      )}

      {error && (
        <p className="load-todays-workout-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
