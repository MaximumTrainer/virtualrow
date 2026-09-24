import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { SplitsTable } from '../components/SplitsTable';
import type { ActivitySample } from '../types/index';

/**
 * Issue #337 — the summary shows the row, split by split.
 *
 * A rower who has just finished wants to know whether they went out too hard.
 * The summary showed totals only; the splits existed in the session and were
 * never rendered, and were wrong anyway (see `sessionSplits.ts`).
 */

const steadyRow = (metres: number, secondsPer500: number): ActivitySample[] => {
  const metresPerSecond = 500 / secondsPer500;
  const seconds = Math.round(metres / metresPerSecond);
  return Array.from({ length: seconds + 1 }, (_, t) => ({
    t,
    distance: Math.min(metres, t * metresPerSecond),
    cadence: 24,
    power: 180,
    heartRate: 150,
  }));
};

const rowsOf = () =>
  screen.getAllByRole('row').slice(1); // drop the header row

describe('the splits table', () => {
  it('lists a row per split', () => {
    render(<SplitsTable samples={steadyRow(2000, 120)} />);

    expect(rowsOf()).toHaveLength(4);
    expect(within(rowsOf()[0]).getByText('500 m')).toBeInTheDocument();
    expect(within(rowsOf()[3]).getByText('2000 m')).toBeInTheDocument();
  });

  it('shows each split as a time a rower reads, not seconds', () => {
    render(<SplitsTable samples={steadyRow(1000, 125)} />);

    // By position, because on a steady 500 m the split's own time and its pace
    // are the same number - which is true, and makes `getByText` ambiguous.
    const cells = within(rowsOf()[0]).getAllByRole('cell');
    expect(cells[0]).toHaveTextContent('2:05'); // took 2:05
    expect(cells[1]).toHaveTextContent('2:05'); // at 2:05/500m
  });

  it('rounds the rower’s averages rather than printing them to fourteen places', () => {
    render(<SplitsTable samples={steadyRow(500, 120)} />);

    expect(within(rowsOf()[0]).getByText('24')).toBeInTheDocument();
    expect(within(rowsOf()[0]).getByText('180')).toBeInTheDocument();
    expect(within(rowsOf()[0]).getByText('150')).toBeInTheDocument();
  });

  // The ragged last piece is not a 500 m split, and a table that shows it as
  // one invites comparing a 400 m pace with four 500 m ones.
  it('marks the last part-split as one', () => {
    render(<SplitsTable samples={steadyRow(2400, 120)} />);

    const last = rowsOf()[4];
    expect(within(last).getByText('2400 m')).toBeInTheDocument();
    expect(last).toHaveAttribute('data-partial', 'true');
    expect(rowsOf()[0]).not.toHaveAttribute('data-partial', 'true');
  });

  it('says nothing at all about a row it has no samples for', () => {
    const { container } = render(<SplitsTable samples={[]} />);

    expect(container).toBeEmptyDOMElement();
  });

  it('leaves a gap where the row recorded no reading', () => {
    const bare = steadyRow(500, 120).map(({ t, distance }) => ({ t, distance }));
    render(<SplitsTable samples={bare} />);

    // A dash, not a zero: the rower did not row 0 W, nothing measured them.
    expect(within(rowsOf()[0]).getAllByText('—').length).toBeGreaterThanOrEqual(3);
  });

  it('is a table, so a screen reader can read it as one', () => {
    render(<SplitsTable samples={steadyRow(1000, 120)} />);

    expect(screen.getByRole('table', { name: /splits/i })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /split/i })).toBeInTheDocument();
  });
});
