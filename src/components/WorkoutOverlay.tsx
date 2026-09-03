import React from 'react';
import type { StructuredWorkout, WorkoutProgress, WorkoutSegment } from '../types/index';
import {
  COMPLIANCE_LABELS,
  complianceOf,
  describeTargets,
  intensityColor,
  intensityLabel,
  segmentTypeLabel,
} from '../utils/workoutPlan';

/**
 * What a rower following a structured workout sees while rowing it
 * (issue #67 §4, §5 and §6): how far through they are, what this segment is
 * asking for, whether they are meeting it, and what is still to come.
 */

export interface WorkoutOverlayProps {
  workout: StructuredWorkout;
  /** The workout's segments with repeats expanded, in the order they are rowed. */
  segments: WorkoutSegment[];
  progress: WorkoutProgress | null;
  /** False when the ergometer has dropped out, so progress has stalled. */
  deviceConnected: boolean;
}

/** Weight for a timeline step, so a long segment draws wider than a short one. */
const stepWeight = (segment: WorkoutSegment): number =>
  Math.max(1, segment.duration ?? segment.distance ?? 1);

const segmentTitle = (segment: WorkoutSegment): string =>
  segment.description?.trim() || segmentTypeLabel(segment.type);

export const WorkoutOverlay: React.FC<WorkoutOverlayProps> = ({
  workout,
  segments,
  progress,
  deviceConnected,
}) => {
  if (!progress) return null;

  const segment = progress.currentSegment;
  const compliance = complianceOf(progress, segment);
  const finished = progress.isComplete === true;

  return (
    <section className="workout-overlay" aria-label="Structured workout">
      <header className="workout-overlay-head">
        <h3 className="workout-overlay-name">{workout.name}</h3>
        {finished && <span className="workout-overlay-done">Workout complete</span>}
      </header>

      {!deviceConnected && !finished && (
        <p className="workout-overlay-stalled" role="alert">
          Rowing machine disconnected — the workout is paused until it reconnects.
        </p>
      )}

      <div className="workout-overlay-bars">
        <div className="workout-bar-row">
          <span className="workout-bar-label">Overall</span>
          <div
            className="workout-bar"
            role="progressbar"
            aria-label="Overall workout progress"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(progress.totalProgress)}
          >
            <span className="workout-bar-fill" style={{ width: `${progress.totalProgress}%` }} />
          </div>
        </div>

        <div className="workout-bar-row">
          <span className="workout-bar-label">Segment</span>
          <div
            className="workout-bar"
            role="progressbar"
            aria-label="Current segment progress"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(progress.segmentProgress)}
          >
            <span
              className="workout-bar-fill"
              style={{
                width: `${progress.segmentProgress}%`,
                backgroundColor: intensityColor(segment.intensity),
              }}
            />
          </div>
        </div>
      </div>

      <div className="workout-overlay-segment">
        <div className="workout-segment-id">
          <span
            className="workout-segment-zone"
            style={{ backgroundColor: intensityColor(segment.intensity) }}
          >
            {intensityLabel(segment.intensity)}
          </span>
          <h4 className="workout-segment-name">{segmentTitle(segment)}</h4>
          <span className="workout-segment-type">{segmentTypeLabel(segment.type)}</span>
        </div>

        <p className="workout-segment-target">{describeTargets(segment)}</p>

        <p className="workout-compliance" role="status" data-compliance={compliance}>
          {COMPLIANCE_LABELS[compliance]}
        </p>
      </div>

      <ol className="workout-timeline" aria-label="Workout timeline">
        {segments.map((step, index) => (
          <li
            key={`${step.id}-${index}`}
            className={`workout-timeline-step${index === progress.currentSegmentIndex ? ' is-current' : ''}`}
            aria-current={index === progress.currentSegmentIndex ? 'step' : undefined}
            style={{
              flexGrow: stepWeight(step),
              backgroundColor: intensityColor(step.intensity),
            }}
            title={`${segmentTitle(step)} — ${intensityLabel(step.intensity)}`}
          />
        ))}
      </ol>
    </section>
  );
};
