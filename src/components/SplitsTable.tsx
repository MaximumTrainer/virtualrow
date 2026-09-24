import React, { useMemo } from 'react';
import { splitsFrom } from '../utils/sessionSplits';
import { formatSplit } from '../utils/formatters';
import type { ActivitySample } from '../types/index';
import './SplitsTable.css';

/**
 * The row, split by split (#337).
 *
 * A rower who has just finished wants to know whether they went out too hard,
 * and the summary showed them totals. The session has carried a `splits` array
 * the whole time and nothing ever rendered it - which was just as well, since
 * it recorded the instantaneous pace at each boundary against the whole row's
 * elapsed time. These come from the sample stream (`sessionSplits.ts`).
 */

export interface SplitsTableProps {
  samples: ActivitySample[];
  /** Metres a split, for a summary that wants finer cuts than 500. */
  every?: number;
}

/** A reading the row never took is a dash, not a zero: nobody rowed 0 W. */
const reading = (value: number | null) => (value === null ? '—' : String(Math.round(value)));

export const SplitsTable: React.FC<SplitsTableProps> = ({ samples, every }) => {
  const splits = useMemo(() => splitsFrom(samples, every), [samples, every]);

  if (splits.length === 0) return null;

  return (
    <table className="splits-table" aria-label="Splits">
      <thead>
        <tr>
          <th scope="col">Split</th>
          <th scope="col">Time</th>
          <th scope="col">/500m</th>
          <th scope="col">SPM</th>
          <th scope="col">Watts</th>
          <th scope="col">BPM</th>
        </tr>
      </thead>
      <tbody>
        {splits.map((split) => (
          <tr
            key={split.meters}
            // The ragged last piece is marked rather than hidden or silently
            // listed: a 400 m pace beside four 500 m ones is not a comparison.
            data-partial={split.complete ? undefined : 'true'}
          >
            <th scope="row">{split.meters} m</th>
            <td>{formatSplit(split.seconds)}</td>
            <td>{formatSplit(split.paceSPer500)}</td>
            <td>{reading(split.spm)}</td>
            <td>{reading(split.watts)}</td>
            <td>{reading(split.hr)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
};
