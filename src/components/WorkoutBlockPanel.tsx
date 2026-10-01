import React from 'react';
import type { StructuredWorkout, WorkoutProgress, WorkoutSegment } from '../types';
import {
  COMPLIANCE_LABELS,
  complianceOf,
  intensityColor,
  intensityLabel,
  intensityMark,
  segmentTypeLabel,
} from '../utils/workoutPlan';
import { formatSplit } from '../utils/formatters';
import './WorkoutBlockPanel.css';

/**
 * The below-rower block panel (issue #445, FR4).
 *
 * Pinned to the bottom of the row stage (D5(a)), it carries the workout's
 * context while the rower rows: the block timeline (reused visual shape from
 * the deleted `WorkoutOverlay`'s `.workout-timeline`), a current-block card
 * with the block's label / type / intensity / prescribed targets / elapsed
 * and remaining seconds, and two "prescribed vs actual" tiles — pace and
 * power — that read out the athlete's live number under the block's
 * prescribed value (D4(b)).
 *
 * The panel does not participate in the FTMS / PM5 control loop itself. The
 * loop lives in `useWorkoutTargetController` and writes to the port; the
 * panel only *reads* the port-independent workout state so the two never
 * fight over the same source of truth (AC8).
 */

export interface WorkoutBlockPanelProps {
  workout: StructuredWorkout;
  /** The workout's segments with repeats expanded, in the order they are rowed. */
  segments: WorkoutSegment[];
  progress: WorkoutProgress;
  /**
   * Live pace in seconds per 500 m, or `null` before the first stroke lands.
   * The pace tile shows `—` for actual until this is a positive number.
   */
  currentPaceSecondsPer500: number | null;
  /** Live instantaneous power in watts, or `null` before the first stroke. */
  currentPowerWatts: number | null;
  /**
   * `false` when the ergometer has dropped out, so progress has stalled.
   * The panel keeps rendering — a rower who reconnects in a minute should
   * find their workout still on screen — but the compliance badge is hidden
   * so a stale "on target" tick does not read as truth (this mirrors
   * `WorkoutOverlay`'s stall handling before it was removed).
   */
  deviceConnected: boolean;
}

/** Weight for a timeline step, so a long segment draws wider than a short one. */
const stepWeight = (segment: WorkoutSegment): number =>
  Math.max(1, segment.duration ?? segment.distance ?? 1);

const segmentTitle = (segment: WorkoutSegment): string =>
  segment.description?.trim() || segmentTypeLabel(segment.type);

const NO_TARGET_LABEL = '—';

const formatSeconds = (seconds: number): string => {
  const clamped = Math.max(0, Math.round(seconds));
  const m = Math.floor(clamped / 60);
  const s = clamped % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
};

const formatPaceValue = (secondsPer500: number | null | undefined): string =>
  typeof secondsPer500 === 'number' && secondsPer500 > 0
    ? formatSplit(secondsPer500)
    : NO_TARGET_LABEL;

const formatPowerValue = (watts: number | null | undefined): string =>
  typeof watts === 'number' && watts > 0 ? `${Math.round(watts)} W` : NO_TARGET_LABEL;

const formatPaceBand = (min?: number, max?: number): string => {
  if (typeof min === 'number' && typeof max === 'number') {
    if (min === max) return formatSplit(min);
    return `${formatSplit(min)}–${formatSplit(max)}`;
  }
  if (typeof min === 'number') return formatSplit(min);
  if (typeof max === 'number') return formatSplit(max);
  return NO_TARGET_LABEL;
};

export const WorkoutBlockPanel: React.FC<WorkoutBlockPanelProps> = ({
  workout,
  segments,
  progress,
  currentPaceSecondsPer500,
  currentPowerWatts,
  deviceConnected,
}) => {
  const segment = progress.currentSegment;
  const compliance = complianceOf(progress, segment);
  const finished = progress.isComplete === true;
  const totalDuration = segment.duration ?? 0;
  const remaining = Math.max(0, totalDuration - progress.segmentElapsedTime);

  const prescribedPace = formatPaceBand(segment.targetPaceMin, segment.targetPaceMax);
  const prescribedPower =
    typeof segment.targetPower === 'number' ? `${Math.round(segment.targetPower)} W` : NO_TARGET_LABEL;
  const hasPaceTarget = prescribedPace !== NO_TARGET_LABEL;
  const hasPowerTarget = prescribedPower !== NO_TARGET_LABEL;

  return (
    <section
      className="workout-block-panel"
      role="region"
      aria-label={`Workout block panel — ${workout.name}`}
    >
      <ol className="workout-block-timeline" aria-label="Workout timeline">
        {segments.map((step, index) => (
          <li
            key={`${step.id}-${index}`}
            className={`workout-block-timeline-step${index === progress.currentSegmentIndex ? ' is-current' : ''}`}
            aria-current={index === progress.currentSegmentIndex ? 'step' : undefined}
            style={{
              flexGrow: stepWeight(step),
              backgroundColor: intensityColor(step.intensity),
            }}
            title={`${segmentTitle(step)} — ${intensityLabel(step.intensity)}`}
          >
            <span className="workout-block-timeline-mark" aria-hidden="true">
              {intensityMark(step.intensity)}
            </span>
            <span className="sr-only">
              {`${segmentTitle(step)} — ${intensityLabel(step.intensity)}`}
            </span>
          </li>
        ))}
      </ol>

      <div className="workout-block-body">
        <div className="workout-block-card">
          <div className="workout-block-card-head">
            <span
              className="workout-block-zone"
              style={{ backgroundColor: intensityColor(segment.intensity) }}
            >
              {intensityLabel(segment.intensity)}
            </span>
            <span className="workout-block-name">{segmentTitle(segment)}</span>
            <span className="workout-block-type">{segmentTypeLabel(segment.type)}</span>
          </div>
          <div className="workout-block-timing">
            <span>Elapsed {formatSeconds(progress.segmentElapsedTime)}</span>
            <span>Remaining {formatSeconds(remaining)}</span>
          </div>
          {deviceConnected && !finished && (
            <p
              className="workout-block-compliance"
              role="status"
              data-compliance={compliance}
            >
              {COMPLIANCE_LABELS[compliance]}
            </p>
          )}
          {finished && <p className="workout-block-done">Workout complete</p>}
        </div>

        <div className="workout-block-tile" data-metric="pace">
          <span className="workout-block-tile-label">Pace</span>
          <span className="workout-block-tile-prescribed">{prescribedPace}</span>
          <span
            className="workout-block-tile-actual"
            aria-live="polite"
            aria-atomic="true"
            data-has-target={hasPaceTarget}
          >
            {formatPaceValue(currentPaceSecondsPer500)}
          </span>
        </div>

        <div className="workout-block-tile" data-metric="power">
          <span className="workout-block-tile-label">Power</span>
          <span className="workout-block-tile-prescribed">{prescribedPower}</span>
          <span
            className="workout-block-tile-actual"
            aria-live="polite"
            aria-atomic="true"
            data-has-target={hasPowerTarget}
          >
            {formatPowerValue(currentPowerWatts)}
          </span>
        </div>
      </div>
    </section>
  );
};
