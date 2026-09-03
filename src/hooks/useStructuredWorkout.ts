import { useCallback, useMemo, useState } from 'react';
import { useServices } from '../context/useServices';
import type {
  PM5Data,
  StructuredWorkout,
  WorkoutProgress,
  WorkoutSegment,
} from '../types/index';
import { validateWorkout } from '../utils/workoutPlan';

/**
 * The rower's structured-workout session (issue #67).
 *
 * `workoutGeneratorService` owns the workout itself — segments, progression
 * and compliance. This hook owns the part that belongs to the app: which
 * workout is chosen, whether one is running, and turning live rower data into
 * progress the UI can render. Per `agents.md`, new feature state lives in a
 * hook rather than in App.tsx.
 */

export const SELECTED_WORKOUT_STORAGE_KEY = 'virtualrow:selected-workout';

const readStoredId = (): string | null => {
  try {
    return localStorage.getItem(SELECTED_WORKOUT_STORAGE_KEY);
  } catch {
    // Private browsing, or storage disabled. No selection is a fine default.
    return null;
  }
};

const writeStoredId = (id: string | null): void => {
  try {
    if (id === null) localStorage.removeItem(SELECTED_WORKOUT_STORAGE_KEY);
    else localStorage.setItem(SELECTED_WORKOUT_STORAGE_KEY, id);
  } catch {
    // The choice still applies for this session.
  }
};

export interface ImportOutcome {
  ok: boolean;
  error?: string;
  workout?: StructuredWorkout;
}

export interface StructuredWorkoutControl {
  /** Every workout available to start, prebuilt and imported. */
  library: StructuredWorkout[];
  /** The workout that will run on the next session, if any. */
  selected: StructuredWorkout | null;
  select: (id: string | null) => void;
  /** Why the selected workout cannot be started, empty when it can. */
  validationErrors: string[];
  /** Begin the selected workout. Returns false if it did not start. */
  start: () => boolean;
  /** End the workout and clear its progress. */
  stop: () => void;
  /** Feed a rower reading in; ignored unless a workout is running. */
  tick: (pm5Data: PM5Data) => void;
  progress: WorkoutProgress | null;
  /** The running workout's segments, repeats expanded, in rowing order. */
  segments: WorkoutSegment[];
  isRunning: boolean;
  isComplete: boolean;
  /** Speed multiplier for the 3D scene, or undefined when no workout is running. */
  speedFactor: number | undefined;
  importFromIntervalsIcu: (
    apiKey: string,
    athleteId: string,
    workoutId: string,
  ) => Promise<ImportOutcome>;
}

export const useStructuredWorkout = (): StructuredWorkoutControl => {
  const { workoutGeneratorService } = useServices();

  // The service owns the workouts; this is the app's view of them, refreshed
  // when an import adds one.
  const [library, setLibrary] = useState<StructuredWorkout[]>(() =>
    workoutGeneratorService.getAllWorkouts(),
  );
  const [selectedId, setSelectedId] = useState<string | null>(readStoredId);
  const [progress, setProgress] = useState<WorkoutProgress | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);

  const selected = useMemo(
    () => (selectedId ? library.find((w) => w.id === selectedId) ?? null : null),
    [library, selectedId],
  );

  // A remembered id whose workout has gone resolves to no selection on its own,
  // so nothing needs clearing. Leaving the id in storage is deliberate: if the
  // workout comes back — re-imported, say — the choice comes back with it.

  const select = useCallback((id: string | null) => {
    setSelectedId(id);
    writeStoredId(id);
    setValidationErrors([]);
  }, []);

  const start = useCallback(() => {
    if (!selected) return false;

    // A segment bounded by neither time nor distance never completes, so the
    // rower would be stranded on it. Refuse before anything starts (#67 F.3).
    const { valid, errors } = validateWorkout(selected);
    if (!valid) {
      setValidationErrors(errors);
      return false;
    }

    const first = workoutGeneratorService.startWorkout(selected.id);
    if (!first) return false;

    setValidationErrors([]);
    setProgress(first);
    setIsRunning(true);
    return true;
  }, [selected, workoutGeneratorService]);

  const stop = useCallback(() => {
    workoutGeneratorService.endWorkout();
    setIsRunning(false);
    setProgress(null);
  }, [workoutGeneratorService]);

  const tick = useCallback(
    (pm5Data: PM5Data) => {
      if (!isRunning) return;

      const next = workoutGeneratorService.updateProgress(pm5Data);
      if (!next) return;

      // Copy: the service mutates one progress object in place, so storing the
      // reference would never re-render.
      setProgress({ ...next });

      if (next.isComplete) {
        workoutGeneratorService.endWorkout();
        setIsRunning(false);
      }
    },
    [isRunning, workoutGeneratorService],
  );

  const importFromIntervalsIcu = useCallback(
    async (apiKey: string, athleteId: string, workoutId: string): Promise<ImportOutcome> => {
      try {
        const imported = await workoutGeneratorService.importFromIntervalsICU(
          apiKey,
          athleteId,
          workoutId,
        );
        if (!imported) {
          return {
            ok: false,
            error:
              'intervals.icu returned no workout for those details. Check the athlete and workout ids.',
          };
        }
        setLibrary(workoutGeneratorService.getAllWorkouts());
        return { ok: true, workout: imported };
      } catch (error) {
        // Never surface the key itself, only what went wrong.
        return { ok: false, error: error instanceof Error ? error.message : 'Import failed.' };
      }
    },
    [workoutGeneratorService],
  );

  return {
    library,
    selected,
    select,
    validationErrors,
    start,
    stop,
    tick,
    progress,
    segments: isRunning || progress ? workoutGeneratorService.getExpandedCurrentSegments() : [],
    isRunning,
    isComplete: progress?.isComplete === true,
    speedFactor: isRunning ? workoutGeneratorService.getSpeedAdjustmentFactor() : undefined,
    importFromIntervalsIcu,
  };
};
