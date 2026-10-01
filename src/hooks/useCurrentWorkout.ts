/**
 * The rower's currently-loaded structured workout (issue #445, formerly
 * `useStructuredWorkout`).
 *
 * A workout is set imperatively from the outside — the
 * {@link LoadTodaysWorkoutButton} fetches today's session from intervals.icu
 * and hands it back through {@link CurrentWorkoutControl.set}. There is no
 * library and no picker any more (FR1). Progress is tracked with the pure
 * {@link WorkoutProgressController} directly here, so the hook has no
 * service dependency beyond deviceConnected.
 *
 * See #445 FR1/FR7/AC12.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PM5Data, StructuredWorkout, WorkoutProgress, WorkoutSegment } from '../types/index';
import { validateWorkout, expandRepeats } from '../utils/workoutPlan';
import { WorkoutProgressController, segmentSpeedFactor } from '../utils/workoutProgress';

export interface CurrentWorkoutControl {
  /** The workout that will run on the next session, if any. */
  current: StructuredWorkout | null;
  /** Load a workout as the current one; clears any progress. */
  set: (workout: StructuredWorkout | null) => void;
  /** Why the current workout cannot be started, empty when it can. */
  validationErrors: string[];
  /** Begin the current workout. Returns false if it did not start. */
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
}

/**
 * @param deviceConnected Whether the ergometer is currently connected. A
 *   workout does not advance while it is away, and the time it was away is not
 *   counted against the rower when it comes back (#67 §8).
 */
export const useCurrentWorkout = (deviceConnected = true): CurrentWorkoutControl => {
  const [current, setCurrent] = useState<StructuredWorkout | null>(null);
  const [progress, setProgress] = useState<WorkoutProgress | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const controllerRef = useRef<WorkoutProgressController | null>(null);

  // A reconnected ergometer brings a clock that kept running. Tell the
  // controller so the next reading's jump is not counted as rowing.
  const wasConnected = useRef(deviceConnected);
  useEffect(() => {
    if (deviceConnected && !wasConnected.current) controllerRef.current?.resumeAfterGap();
    wasConnected.current = deviceConnected;
  }, [deviceConnected]);

  const set = useCallback((workout: StructuredWorkout | null) => {
    setCurrent(workout);
    setProgress(null);
    setIsRunning(false);
    setValidationErrors([]);
    controllerRef.current = null;
  }, []);

  const start = useCallback(() => {
    if (!current) return false;
    const { valid, errors } = validateWorkout(current);
    if (!valid) {
      setValidationErrors(errors);
      return false;
    }
    controllerRef.current = new WorkoutProgressController(current);
    setValidationErrors([]);
    setProgress(controllerRef.current.getProgress());
    setIsRunning(true);
    return true;
  }, [current]);

  const stop = useCallback(() => {
    controllerRef.current = null;
    setIsRunning(false);
    setProgress(null);
  }, []);

  const tick = useCallback(
    (pm5Data: PM5Data) => {
      if (!isRunning || !controllerRef.current) return;
      const next = controllerRef.current.update(pm5Data);
      setProgress(next);
      if (next.isComplete) {
        controllerRef.current = null;
        setIsRunning(false);
      }
    },
    [isRunning],
  );

  const segments = useMemo(
    () => (current ? expandRepeats(current.segments) : []),
    [current],
  );

  const speedFactor =
    isRunning && progress ? segmentSpeedFactor(progress.currentSegment) : undefined;

  return {
    current,
    set,
    validationErrors,
    start,
    stop,
    tick,
    progress,
    segments,
    isRunning,
    isComplete: progress?.isComplete === true,
    speedFactor,
  };
};
