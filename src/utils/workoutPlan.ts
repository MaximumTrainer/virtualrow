/**
 * Presentation logic for structured workouts (issue #67).
 *
 * `workoutGeneratorService` owns running a workout — advancing segments and
 * judging compliance against the PM5. This module owns the questions the UI
 * asks about a workout: is it startable, what does it add up to, what is this
 * segment asking for, and what should the compliance light say.
 *
 * Pure throughout, so the answers can be tested without a rowing machine.
 */
import type { StructuredWorkout, WorkoutSegment, WorkoutProgress } from '../types/index';

/** Whether this segment asks the rower for anything measurable. */
export const segmentHasTarget = (segment: WorkoutSegment): boolean =>
  (segment.targetPaceMin !== undefined && segment.targetPaceMax !== undefined) ||
  segment.targetPower !== undefined ||
  (segment.targetHeartRateMin !== undefined && segment.targetHeartRateMax !== undefined) ||
  segment.cadence !== undefined;

/**
 * What the compliance indicator should say.
 *
 * `untargeted` is the state the service cannot express: it reports
 * `isOnTarget: true` for a segment that set no targets at all, which would
 * light a green "on target" for a workout that never asked for anything.
 * `off-target` covers being outside a target whose direction is unknown.
 */
export type ComplianceState = 'untargeted' | 'on-target' | 'too-fast' | 'too-slow' | 'off-target';

export const complianceOf = (
  progress: Pick<WorkoutProgress, 'isOnTarget' | 'deviationPercent'>,
  segment: WorkoutSegment,
): ComplianceState => {
  if (!segmentHasTarget(segment)) return 'untargeted';
  if (progress.isOnTarget) return 'on-target';

  const deviation = progress.deviationPercent ?? 0;
  if (deviation > 0) return 'too-fast';
  if (deviation < 0) return 'too-slow';
  return 'off-target';
};

/** Human-readable copy for each compliance state. */
export const COMPLIANCE_LABELS: Record<ComplianceState, string> = {
  untargeted: 'No target',
  'on-target': 'On target',
  'too-fast': 'Ease off',
  'too-slow': 'Push on',
  'off-target': 'Off target',
};

export interface WorkoutValidation {
  valid: boolean;
  errors: string[];
}

/** How a segment should be named in a message to the rower. */
const segmentLabel = (segment: WorkoutSegment, index: number): string =>
  segment.description?.trim() || `${segment.type} segment ${index + 1}`;

/**
 * Whether a workout can be started at all.
 *
 * A segment bounded by neither time nor distance never completes, so the
 * workout would stall on it forever. Better to refuse the start and say which
 * segment is at fault than to strand the rower mid-session.
 */
export const validateWorkout = (workout: StructuredWorkout): WorkoutValidation => {
  const errors: string[] = [];

  if (workout.segments.length === 0) {
    errors.push('This workout has no segments.');
  }

  workout.segments.forEach((segment, index) => {
    const hasDuration = (segment.duration ?? 0) > 0;
    const hasDistance = (segment.distance ?? 0) > 0;
    if (!hasDuration && !hasDistance) {
      errors.push(`"${segmentLabel(segment, index)}" has neither a duration nor a distance.`);
    }
  });

  return { valid: errors.length === 0, errors };
};

export interface WorkoutSummary {
  segmentCount: number;
  totalDurationSec: number;
  totalDistanceMeters?: number;
}

/** Expand `repeat` into concrete segments, as the service does when running one. */
export const expandRepeats = (segments: WorkoutSegment[]): WorkoutSegment[] =>
  segments.flatMap((segment) =>
    segment.repeat && segment.repeat > 1
      ? Array.from({ length: segment.repeat }, (_, i) => ({
          ...segment,
          id: `${segment.id}-rep-${i + 1}`,
          repeat: undefined,
        }))
      : [segment],
  );

/** What a workout adds up to, counted the way it will actually be rowed. */
export const summariseWorkout = (workout: StructuredWorkout): WorkoutSummary => {
  const expanded = expandRepeats(workout.segments);
  const totalDistanceMeters = expanded.reduce((total, s) => total + (s.distance ?? 0), 0);

  return {
    segmentCount: expanded.length,
    totalDurationSec: expanded.reduce((total, s) => total + (s.duration ?? 0), 0),
    totalDistanceMeters: totalDistanceMeters > 0 ? totalDistanceMeters : undefined,
  };
};

/** Seconds per 500 m as a rower reads it: `1:50`, not `110`. */
export const formatPace = (secondsPer500: number): string => {
  const whole = Math.max(0, Math.round(secondsPer500));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
};

/** Everything this segment asks for, in one line. */
export const describeTargets = (segment: WorkoutSegment): string => {
  const parts: string[] = [];

  if (segment.targetPaceMin !== undefined && segment.targetPaceMax !== undefined) {
    parts.push(`${formatPace(segment.targetPaceMin)}–${formatPace(segment.targetPaceMax)} /500m`);
  }
  if (segment.targetPower !== undefined) {
    parts.push(`${Math.round(segment.targetPower)} W`);
  }
  if (segment.targetHeartRateMin !== undefined && segment.targetHeartRateMax !== undefined) {
    parts.push(`${segment.targetHeartRateMin}–${segment.targetHeartRateMax} bpm`);
  }
  if (segment.cadence !== undefined) {
    parts.push(`${segment.cadence} spm`);
  }

  return parts.length > 0 ? parts.join(' · ') : 'No target';
};

/**
 * Zone colours, cool through hot.
 *
 * Read left to right on the timeline, the ramp is what tells a rower where the
 * hard bits are without reading a word.
 */
export const INTENSITY_COLORS: Record<NonNullable<WorkoutSegment['intensity']>, string> = {
  recovery: '#4a90c2',
  zone1: '#3fa9a0',
  zone2: '#5cb85c',
  zone3: '#d4b13a',
  zone4: '#e08733',
  zone5: '#d9534f',
  max: '#a02c2c',
};

/** Colour for a segment, falling back to a neutral for an unzoned one. */
export const intensityColor = (intensity: WorkoutSegment['intensity']): string =>
  intensity ? INTENSITY_COLORS[intensity] : '#8a8f96';

export const intensityLabel = (intensity: WorkoutSegment['intensity']): string => {
  if (!intensity) return 'Unzoned';
  if (intensity === 'recovery') return 'Recovery';
  if (intensity === 'max') return 'Max';
  return `Zone ${intensity.replace('zone', '')}`;
};

/** Segment type as a heading: `work` → `Work`. */
export const segmentTypeLabel = (type: WorkoutSegment['type']): string =>
  type.charAt(0).toUpperCase() + type.slice(1);
