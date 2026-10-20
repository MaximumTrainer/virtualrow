/**
 * Structured-workout progression state (issue #445, formerly in
 * `workoutGeneratorService`).
 *
 * The controller sits between the ergometer's readings and the block panel's
 * view: it takes a stream of {@link PM5Data} in and returns the {@link
 * WorkoutProgress} that the panel renders. Pulled out of the deleted
 * `workoutGeneratorService` so a workout does not need a generator at all —
 * one is set imperatively by `useCurrentWorkout` after fetching it from
 * intervals.icu.
 *
 * The rules the panel actually cares about (see #67's original acceptance
 * criteria, ported here in {@link src/__tests__/workoutProgress.test.ts}):
 *
 * - Time-based segments advance on elapsed seconds; distance-based segments
 *   on metres. A distance segment never advances on time alone.
 * - Each new segment measures from the reading that started it, not from the
 *   row's own start.
 * - A `repeat` on a segment expands to that many concrete segments.
 * - A gap in the readings (a dropped ergometer that came back with a clock
 *   that kept running) is not counted against the rower: the caller says so
 *   through {@link resumeAfterGap} and the next reading's jump in elapsed
 *   time is discounted.
 */
import type { PM5Data, StructuredWorkout, WorkoutProgress, WorkoutSegment } from '../types/index';
import { expandRepeats } from './workoutPlan';

/**
 * How the compliance light is judged.
 *
 * Pulled out of the service so the same rule the panel reads
 * (`complianceOf` in `workoutPlan.ts`) is fed by numbers we set here rather
 * than by a hidden branch inside the service.
 */
const PACE_TARGET_TOLERANCE_PERCENT = 0;
const POWER_TARGET_TOLERANCE_PERCENT = 10;

export class WorkoutProgressController {
  private readonly workout: StructuredWorkout;
  private readonly segments: WorkoutSegment[];
  private progress: WorkoutProgress;

  private segmentStartElapsedSec = 0;
  private segmentStartDistanceM = 0;
  private lastReadingElapsedSec: number | null = null;
  private notRowedSec = 0;
  private rebaseOnNextReading = false;

  constructor(workout: StructuredWorkout) {
    this.workout = workout;
    this.segments = expandRepeats(workout.segments);
    this.progress = {
      workoutId: workout.id,
      currentSegmentIndex: 0,
      currentSegment: this.segments[0],
      segmentElapsedTime: 0,
      segmentProgress: 0,
      totalElapsedTime: 0,
      totalProgress: 0,
      isOnTarget: true,
      deviationPercent: 0,
    };
  }

  /** Every segment the rower will row, `repeat` already expanded. */
  getExpandedSegments(): WorkoutSegment[] {
    return this.segments;
  }

  getProgress(): WorkoutProgress {
    return this.progress;
  }

  /**
   * The rower's ergometer went away and has come back. The next reading's
   * jump in elapsed time is not the rower's work, so it is discounted.
   */
  resumeAfterGap(): void {
    this.rebaseOnNextReading = true;
  }

  /**
   * Feed the next reading in and get back the updated progress. Returns a
   * fresh object each time so a React `setState` on the reference triggers
   * a re-render.
   */
  update(pm5Data: PM5Data): WorkoutProgress {
    const readingElapsedSec = Math.floor(pm5Data.elapsedTime / 1000);
    if (this.rebaseOnNextReading && this.lastReadingElapsedSec !== null) {
      this.notRowedSec += Math.max(0, readingElapsedSec - this.lastReadingElapsedSec);
    }
    this.rebaseOnNextReading = false;
    this.lastReadingElapsedSec = readingElapsedSec;

    const elapsedSeconds = readingElapsedSec - this.notRowedSec;
    this.progress.totalElapsedTime = elapsedSeconds;
    this.progress.segmentElapsedTime = elapsedSeconds - this.segmentStartElapsedSec;

    const segment = this.progress.currentSegment;
    if (segment.duration) {
      this.progress.segmentProgress = Math.min(
        100,
        (this.progress.segmentElapsedTime / segment.duration) * 100,
      );
      if (this.progress.segmentElapsedTime >= segment.duration) {
        this.advance(elapsedSeconds, pm5Data.distance);
      }
    } else if (segment.distance) {
      const distanceInSegment = pm5Data.distance - this.segmentStartDistanceM;
      this.progress.segmentProgress = Math.min(
        100,
        (distanceInSegment / segment.distance) * 100,
      );
      if (distanceInSegment >= segment.distance) {
        this.advance(elapsedSeconds, pm5Data.distance);
      }
    }

    if (!this.progress.isComplete) {
      this.progress.totalProgress = Math.min(
        100,
        (this.progress.totalElapsedTime / this.workout.totalDuration) * 100,
      );
    }

    this.checkCompliance(pm5Data);

    // Copy so a React setState on the reference actually re-renders.
    this.progress = { ...this.progress };
    return this.progress;
  }

  private advance(elapsedSeconds: number, distanceMeters: number): void {
    const nextIndex = this.progress.currentSegmentIndex + 1;
    if (nextIndex < this.segments.length) {
      this.progress.currentSegmentIndex = nextIndex;
      this.progress.currentSegment = this.segments[nextIndex];
      this.progress.segmentElapsedTime = 0;
      this.progress.segmentProgress = 0;
      this.segmentStartElapsedSec = elapsedSeconds;
      this.segmentStartDistanceM = distanceMeters;
    } else {
      this.progress.isComplete = true;
      this.progress.segmentProgress = 100;
      this.progress.totalProgress = 100;
    }
  }

  private checkCompliance(pm5Data: PM5Data): void {
    const segment = this.progress.currentSegment;
    let isOnTarget = true;
    let deviation = 0;

    if (
      segment.targetPaceMin !== undefined &&
      segment.targetPaceMax !== undefined &&
      pm5Data.pace
    ) {
      const min = segment.targetPaceMin * (1 - PACE_TARGET_TOLERANCE_PERCENT / 100);
      const max = segment.targetPaceMax * (1 + PACE_TARGET_TOLERANCE_PERCENT / 100);
      if (pm5Data.pace < min) {
        isOnTarget = false;
        deviation = ((min - pm5Data.pace) / min) * 100;
      } else if (pm5Data.pace > max) {
        isOnTarget = false;
        deviation = -((pm5Data.pace - max) / max) * 100;
      }
    }

    if (segment.targetPower !== undefined && pm5Data.power) {
      const tolerance = segment.targetPower * (POWER_TARGET_TOLERANCE_PERCENT / 100);
      if (Math.abs(pm5Data.power - segment.targetPower) > tolerance) {
        isOnTarget = false;
        deviation = ((pm5Data.power - segment.targetPower) / segment.targetPower) * 100;
      }
    }

    if (
      segment.targetHeartRateMin !== undefined &&
      segment.targetHeartRateMax !== undefined &&
      pm5Data.heartRate
    ) {
      if (
        pm5Data.heartRate < segment.targetHeartRateMin ||
        pm5Data.heartRate > segment.targetHeartRateMax
      ) {
        isOnTarget = false;
        deviation =
          pm5Data.heartRate < segment.targetHeartRateMin
            ? -((segment.targetHeartRateMin - pm5Data.heartRate) / segment.targetHeartRateMin) * 100
            : ((pm5Data.heartRate - segment.targetHeartRateMax) / segment.targetHeartRateMax) * 100;
      }
    }

    this.progress.isOnTarget = isOnTarget;
    this.progress.deviationPercent = deviation;
  }
}

/**
 * The simulator's speed factor as a function of the workout's current
 * segment (issue #445, replaces the deleted
 * `workoutGeneratorService.getSpeedAdjustmentFactor`). Reads only the
 * segment's intensity, so it does not need the controller.
 */
export function segmentSpeedFactor(segment: WorkoutSegment | undefined): number {
  const table: Record<NonNullable<WorkoutSegment['intensity']>, number> = {
    recovery: 0.6,
    zone1: 0.7,
    zone2: 0.8,
    zone3: 0.9,
    zone4: 1.0,
    zone5: 1.1,
    max: 1.2,
  };
  return segment?.intensity ? table[segment.intensity] : 1.0;
}
