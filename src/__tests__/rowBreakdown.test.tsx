import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ActivitySample, WorkoutSession } from '../types/index';

vi.mock('react-chartjs-2', () => ({
  Line: () => <canvas data-testid="row-chart" />,
}));

const download = vi.hoisted(() => vi.fn());
vi.mock('../utils/exporters', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../utils/exporters')>()),
  triggerBlobDownload: download,
}));

import { RowBreakdown } from '../components/RowBreakdown';

/**
 * Issue #337 — the row itself, under the totals: the splits, a chart, how it
 * compares with this athlete's best on the route, and a card to share.
 */

const samples = (metres: number): ActivitySample[] =>
  Array.from({ length: Math.ceil(metres / 4) + 1 }, (_, t) => ({
    t,
    distance: Math.min(metres, t * 4),
    pace: 125,
    power: 170,
    cadence: 26,
    heartRate: 141,
  }));

const session = (overrides: Partial<WorkoutSession> = {}): WorkoutSession => ({
  id: 's-1',
  routeId: 'r1',
  routeName: 'Willowbrook River',
  startTime: new Date('2026-03-14T08:00:00Z'),
  duration: 500,
  distance: 2000,
  averagePace: 123,
  calories: 100,
  splits: [],
  isActive: false,
  samples: samples(2000),
  ...overrides,
});

describe('RowBreakdown', () => {
  beforeEach(() => download.mockReset());

  it('lists one split per 500 m', () => {
    render(<RowBreakdown session={session()} />);
    const table = screen.getByRole('table', { name: 'Splits' });
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows.map((r) => within(r).getAllByRole('cell')[0].textContent)).toEqual([
      '500 m',
      '1 000 m',
      '1 500 m',
      '2 000 m',
    ]);
    expect(within(rows[0]).getByText('2:05')).toBeInTheDocument();
    expect(within(rows[0]).getByText('26')).toBeInTheDocument();
  });

  it('draws the row as a chart', () => {
    render(<RowBreakdown session={session()} />);
    expect(screen.getByTestId('row-chart')).toBeInTheDocument();
  });

  it('says a first row on the route is one, rather than comparing it with nothing', () => {
    render(<RowBreakdown session={session()} personalBest={null} />);
    expect(screen.getByTestId('row-pb')).toHaveTextContent('First row on this route');
  });

  it('compares the average split with the best on this route', () => {
    render(<RowBreakdown session={session({ averagePace: 123 })} personalBest={125} />);
    const pb = screen.getByTestId('row-pb');
    expect(pb).toHaveTextContent('Personal best 2:05/500m');
    expect(pb).toHaveTextContent('−0:02 today');
    expect(pb).toHaveAttribute('data-trend', 'faster');
  });

  it('marks a slower row as slower', () => {
    render(<RowBreakdown session={session({ averagePace: 128 })} personalBest={125} />);
    expect(screen.getByTestId('row-pb')).toHaveAttribute('data-trend', 'slower');
  });

  it('leaves the comparison out where there is no history to compare with', () => {
    render(<RowBreakdown session={session()} />);
    expect(screen.queryByTestId('row-pb')).toBeNull();
  });

  it('says so when the row recorded nothing to break down', () => {
    render(<RowBreakdown session={session({ samples: [] })} />);
    expect(screen.queryByRole('table', { name: 'Splits' })).toBeNull();
    expect(screen.queryByTestId('row-chart')).toBeNull();
  });

  describe('the share card', () => {
    let restore: () => void;
    beforeEach(() => {
      const getContext = HTMLCanvasElement.prototype.getContext;
      const toBlob = HTMLCanvasElement.prototype.toBlob;
      HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
        fillRect: vi.fn(),
        fillText: vi.fn(),
        createLinearGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
      })) as unknown as typeof getContext;
      HTMLCanvasElement.prototype.toBlob = function (cb: BlobCallback, type?: string) {
        cb(new Blob(['png'], { type: type ?? 'image/png' }));
      };
      restore = () => {
        HTMLCanvasElement.prototype.getContext = getContext;
        HTMLCanvasElement.prototype.toBlob = toBlob;
      };
    });
    afterEach(() => restore());

    it('downloads a PNG of the row, made in the browser', async () => {
      render(<RowBreakdown session={session()} />);
      await userEvent.click(screen.getByRole('button', { name: /share/i }));

      await waitFor(() => expect(download).toHaveBeenCalledTimes(1));
      const [blob, type, name] = download.mock.calls[0];
      expect(blob).toBeInstanceOf(Blob);
      expect((blob as Blob).type).toBe('image/png');
      expect(type).toBe('image/png');
      expect(name).toBe('willowbrook-river-2026-03-14.png');
    });
  });
});
