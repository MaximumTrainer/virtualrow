import React from 'react';
import { pbDelta } from '../utils/sessionSplits';
import { formatSplit } from '../utils/formatters';
import './PersonalBestLine.css';

/**
 * Today's row against the rower's best on this route (#337).
 *
 * The summary reported a time and a distance and nothing to measure them
 * against, so a rower could not tell a good row from an ordinary one without
 * remembering their own history.
 *
 * The comparison is per route. `getStats().bestPace` is the quickest pace
 * across every session on any route, which held up beside a 5 km paddle calls
 * it a failure for not being a 500 m sprint.
 */

export interface PersonalBestLineProps {
  /** Seconds per 500 m for the row just finished. */
  averagePace: number;
  /** The rower's best on this route, excluding today. Null on a first row. */
  best: number | null;
}

export const PersonalBestLine: React.FC<PersonalBestLineProps> = ({ averagePace, best }) => {
  const delta = pbDelta(averagePace, best);

  // A first row on a route is not a defeat, and saying "+0:00" would imply one.
  if (delta === null) {
    return (
      <p className="personal-best personal-best--first">
        Your first row on this route — this is the time to beat.
      </p>
    );
  }

  const faster = delta < 0;
  const sameToTheSecond = Math.round(delta) === 0;

  return (
    <p
      className="personal-best"
      data-result={sameToTheSecond ? 'level' : faster ? 'faster' : 'slower'}
    >
      <span className="personal-best-label">Personal best</span>{' '}
      <span className="personal-best-value">{formatSplit(best!)}/500m</span>{' '}
      {sameToTheSecond ? (
        <span className="personal-best-delta">— matched to the second</span>
      ) : (
        <span className="personal-best-delta">
          {/* The sign spelled out. A bare "-2" beside a time reads as a
              subtraction rather than as two seconds quicker. */}
          {faster ? '−' : '+'}
          {formatSplit(Math.abs(delta))} {faster ? 'faster today' : 'slower today'}
        </span>
      )}
    </p>
  );
};
