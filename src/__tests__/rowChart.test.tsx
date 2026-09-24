import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RowChart } from '../components/RowChart';
import type { ActivitySample } from '../types/index';

/**
 * Issue #337 — the pace and heart rate chart on the summary.
 *
 * Chart.js draws to a canvas, which jsdom does not have and a screen reader
 * cannot read. The `<Line>` is mocked and its props inspected, as
 * `heartRateChart.test.tsx` does: what matters here is what the chart is asked
 * to draw, and that the page says the same thing in text beside it.
 */

interface CapturedLine {
  data: {
    labels: number[];
    datasets: { label: string; data: (number | null)[]; yAxisID?: string }[];
  };
  options: {
    scales?: Record<
      string,
      {
        reverse?: boolean;
        title?: { text?: string };
        ticks?: { callback?: (value: string | number, index: number) => string };
      }
    >;
    plugins?: {
      tooltip?: {
        callbacks?: {
          label?: (item: { dataset: { label?: string }; parsed: { y: number | null } }) => string;
          title?: (items: { label?: string }[]) => string;
        };
      };
    };
  };
}

const captured = vi.hoisted(() => ({ current: null as CapturedLine | null }));

vi.mock('react-chartjs-2', () => ({
  Line: (props: unknown) => {
    captured.current = props as CapturedLine;
    return <div data-testid="row-chart-canvas" />;
  },
}));

const steadyRow = (metres: number): ActivitySample[] =>
  Array.from({ length: metres / 10 + 1 }, (_, i) => ({
    t: i,
    distance: i * 10,
    pace: 120,
    heartRate: 150,
  }));

beforeEach(() => {
  captured.current = null;
});

describe('the row chart', () => {
  it('draws pace and heart rate against the metres rowed', () => {
    render(<RowChart samples={steadyRow(1000)} />);

    const { labels, datasets } = captured.current!.data;
    expect(labels[0]).toBe(0);
    expect(labels[labels.length - 1]).toBe(1000);
    expect(datasets.map((d) => d.label)).toEqual([
      expect.stringMatching(/pace/i),
      expect.stringMatching(/heart rate/i),
    ]);
  });

  /**
   * A faster split is a smaller number of seconds.
   *
   * Drawn on an ordinary axis the fast opening would sink and the tired
   * finish would climb, so the chart would read as the exact opposite of the
   * row. Reversing the axis puts quicker at the top, where a rower looks for
   * it.
   */
  it('reverses the pace axis, so quicker reads as higher', () => {
    render(<RowChart samples={steadyRow(1000)} />);

    expect(captured.current!.options.scales?.pace?.reverse).toBe(true);
    expect(captured.current!.options.scales?.hr?.reverse).toBeFalsy();
  });

  // Seconds per 500 m and beats per minute share no scale: on one axis a
  // 2:00 pace and a 150 bpm heart rate flatten each other into two lines
  // that never move.
  it('gives heart rate an axis of its own', () => {
    render(<RowChart samples={steadyRow(1000)} />);

    const [pace, hr] = captured.current!.data.datasets;
    expect(pace.yAxisID).toBe('pace');
    expect(hr.yAxisID).toBe('hr');
  });

  // "125" beside a pace means nothing to a rower; 2:05 is the number they row to.
  it('reads a pace back as a time, not as seconds', () => {
    render(<RowChart samples={steadyRow(1000)} />);

    const label = captured.current!.options.plugins?.tooltip?.callbacks?.label;
    expect(label!({ dataset: { label: 'Pace (/500m)' }, parsed: { y: 125 } })).toBe('2:05 /500m');
    expect(label!({ dataset: { label: 'Heart rate (bpm)' }, parsed: { y: 150 } })).toBe('150 bpm');
  });

  /**
   * A canvas is opaque to a screen reader (#344).
   *
   * The chart is a picture of numbers the summary already knows, so the same
   * reading is given in text rather than being locked inside the drawing.
   */
  it('says in text what it draws in pixels', () => {
    render(<RowChart samples={steadyRow(1000)} />);

    expect(screen.getByRole('figure', { name: /pace and heart rate/i })).toBeInTheDocument();
    expect(screen.getByText(/1000 m/)).toBeInTheDocument();
  });

  it('draws nothing at all for a row with no samples', () => {
    const { container } = render(<RowChart samples={[]} />);

    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByTestId('row-chart-canvas')).toBeNull();
  });
  // The axis is metres, so the ticks say metres rather than the index of the
  // point that happens to sit there.
  it('labels its axes in the units the row was rowed in', () => {
    render(<RowChart samples={steadyRow(1000)} />);

    const { scales, plugins } = captured.current!.options;
    expect(scales?.x?.ticks?.callback?.(0, 1)).toBe(10);
    expect(scales?.pace?.ticks?.callback?.(125, 0)).toBe('2:05');
    expect(plugins?.tooltip?.callbacks?.title?.([{ label: '1500' }])).toBe('1500 m');
  });

  // A gap in the recording is drawn as a gap; the tooltip has nothing to read
  // out for one.
  it('reads nothing back for a point the row never recorded', () => {
    render(<RowChart samples={steadyRow(1000)} />);

    const label = captured.current!.options.plugins?.tooltip?.callbacks?.label;
    expect(label!({ dataset: { label: 'Pace (/500m)' }, parsed: { y: null } })).toBe('');
  });
});
