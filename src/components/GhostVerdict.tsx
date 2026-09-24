import React from 'react';
import { formatSplit } from '../utils/formatters';
import './GhostVerdict.css';

/**
 * How the race came out (#338).
 *
 * The rower watched a gap all the way down the course, and the summary is
 * where it is settled. The pace comparison #337 puts on this screen answers
 * "was this a good row"; this answers "did I beat the thing I was chasing",
 * which is the question the row was actually rowed to.
 */

export interface GhostVerdictProps {
  /** Seconds the row took. */
  rowSeconds: number;
  /** Seconds the ghost took to the same distance, or null if it never got there. */
  ghostSeconds: number | null;
  /** What was being chased — "your best", "a 2:00 pace". Null when nothing was. */
  label: string | null;
}

/** Inside a second is a dead heat; a tenth either way is not a story. */
const DEAD_HEAT_SECONDS = 1;

export const GhostVerdict: React.FC<GhostVerdictProps> = ({ rowSeconds, ghostSeconds, label }) => {
  if (label === null) return null;

  if (ghostSeconds === null) {
    return (
      <p className="ghost-verdict" data-result="unfinished" role="status">
        {label} did not reach this distance, so there was nothing to race to the line.
      </p>
    );
  }

  const margin = ghostSeconds - rowSeconds;
  const result = Math.abs(margin) < DEAD_HEAT_SECONDS ? 'level' : margin > 0 ? 'won' : 'lost';

  return (
    <p className="ghost-verdict" data-result={result} role="status">
      {result === 'level' && <>A dead heat with {label}.</>}
      {result === 'won' && (
        <>
          You beat {label} by {formatSplit(margin)}.
        </>
      )}
      {result === 'lost' && (
        <>
          {label.charAt(0).toUpperCase()}
          {label.slice(1)} was {formatSplit(-margin)} quicker.
        </>
      )}
    </p>
  );
};

export default GhostVerdict;
