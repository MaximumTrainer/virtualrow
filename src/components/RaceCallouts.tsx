import type { StartPhase } from '../hooks/useStartSequence';
import { formatCourseMetres, formatTime } from '../utils/formatters';
import './RaceCallouts.css';

/**
 * What the rower is told at each end of the course (#336): "Ready", the 3-2-1
 * and "Row!" at the start, and the distance and time at the finish.
 *
 * Both are `role="status"`, so a screen reader hears the count without the
 * rower having to look away from the erg.
 */

export function StartCallout({ phase, countdown }: { phase: StartPhase; countdown: number | null }) {
  if (phase === 'idle' || phase === 'rowing') return null;

  const text =
    phase === 'armed' ? 'Ready — take your first stroke' : phase === 'go' ? 'Row!' : String(countdown);

  return (
    <div className="race-callout" role="status" data-testid="start-callout" data-phase={phase}>
      <span className={phase === 'armed' ? 'race-callout-prompt' : 'race-callout-count'}>{text}</span>
    </div>
  );
}

export function FinishBanner({ distanceMeters, elapsedMs }: { distanceMeters: number; elapsedMs: number }) {
  return (
    <div className="race-callout race-callout--finish" role="status" data-testid="finish-banner">
      <span className="race-callout-prompt">
        Finished — {formatCourseMetres(distanceMeters)} m in {formatTime(elapsedMs)}
      </span>
    </div>
  );
}
