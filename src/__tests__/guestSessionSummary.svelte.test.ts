import { describe, expect, it, vi } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/svelte';
import type { WorkoutSession } from '../lib/types/index';

// Chart.js needs a real 2D context jsdom lacks; stub it like the React suite
// stubbed react-chartjs-2's Line, so the test exercises the summary's markup.
vi.mock('chart.js', () => {
  class Chart {
    static register() {}
    destroy() {}
  }
  const passthrough = {};
  return {
    Chart,
    CategoryScale: passthrough,
    Legend: passthrough,
    LinearScale: passthrough,
    LineController: passthrough,
    LineElement: passthrough,
    PointElement: passthrough,
    Tooltip: passthrough,
  };
});

import GuestSessionSummary from '../lib/ui/GuestSessionSummary.svelte';

function makeSession(overrides: Partial<WorkoutSession> = {}): WorkoutSession {
  return {
    id: 's1',
    routeId: '1',
    routeName: 'Willowbrook River',
    startTime: new Date('2026-01-02T10:00:00Z'),
    endTime: new Date('2026-01-02T10:20:00Z'),
    duration: 1200,
    distance: 4200,
    averagePace: 124,
    calories: 180,
    splits: [],
    isActive: false,
    samples: [],
    ...overrides,
  };
}

describe('GuestSessionSummary', () => {
  it('names exactly what signing in would have preserved (TD-3)', () => {
    render(GuestSessionSummary, {
      session: makeSession({ heartRateAvg: 145, heartRateMax: 162 }),
      onRowAgain: vi.fn(),
      onExit: vi.fn(),
    });

    const copy = screen.getByText(/signing in with intervals\.icu/i);
    expect(copy.textContent).toMatch(/distance/i);
    expect(copy.textContent).toMatch(/time/i);
    expect(copy.textContent).toMatch(/average pace/i);
    expect(copy.textContent).toMatch(/calories/i);
    expect(copy.textContent).toMatch(/heart rate/i);
  });

  it('omits heart rate from the list when the session captured none', () => {
    render(GuestSessionSummary, { session: makeSession(), onRowAgain: vi.fn(), onExit: vi.fn() });

    const copy = screen.getByText(/signing in with intervals\.icu/i);
    expect(copy.textContent).toMatch(/calories/i);
    expect(copy.textContent).not.toMatch(/heart rate/i);
  });

  it('states plainly that the session was not saved', () => {
    render(GuestSessionSummary, { session: makeSession(), onRowAgain: vi.fn(), onExit: vi.fn() });
    expect(screen.getByText(/has not been saved/i)).toBeTruthy();
  });

  it('marks a demo row as simulated so it is never read as a real session (TD-2)', () => {
    render(GuestSessionSummary, { session: makeSession(), onRowAgain: vi.fn(), onExit: vi.fn(), isDemo: true });

    expect(screen.getByText('Demo Row')).toBeTruthy();
    expect(screen.getByText(/demo on simulated data/i)).toBeTruthy();
  });

  it('labels a non-demo session as a guest session', () => {
    render(GuestSessionSummary, { session: makeSession(), onRowAgain: vi.fn(), onExit: vi.fn() });
    expect(screen.getByText('Guest Session')).toBeTruthy();
  });

  it('offers sign-in when a handler is supplied, and calls it', async () => {
    const onSignIn = vi.fn();
    render(GuestSessionSummary, { session: makeSession(), onRowAgain: vi.fn(), onExit: vi.fn(), onSignIn });

    await fireEvent.click(screen.getByRole('button', { name: /sign in to save future rows/i }));
    expect(onSignIn).toHaveBeenCalledTimes(1);
  });

  it('omits the sign-in control when no handler is supplied', () => {
    render(GuestSessionSummary, { session: makeSession(), onRowAgain: vi.fn(), onExit: vi.fn() });
    expect(screen.queryByRole('button', { name: /sign in/i })).toBeNull();
  });

  it('still offers Row Again and Done', async () => {
    const onRowAgain = vi.fn();
    const onExit = vi.fn();
    render(GuestSessionSummary, { session: makeSession(), onRowAgain, onExit });

    await fireEvent.click(screen.getByRole('button', { name: /row again/i }));
    await fireEvent.click(screen.getByRole('button', { name: /done/i }));
    expect(onRowAgain).toHaveBeenCalledTimes(1);
    expect(onExit).toHaveBeenCalledTimes(1);
  });
});

describe('GuestSessionSummary — the row itself (#337)', () => {
  const samples = Array.from({ length: 501 }, (_, t) => ({ t, distance: t * 4, pace: 125, cadence: 24 }));

  it('shows the splits and the chart a signed-in rower gets', () => {
    render(GuestSessionSummary, {
      session: makeSession({ distance: 2000, samples }),
      onRowAgain: vi.fn(),
      onExit: vi.fn(),
    });
    const rows = within(screen.getByRole('table', { name: 'Splits' })).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(4);
    expect(screen.getByTestId('row-chart')).toBeTruthy();
  });

  it('makes no comparison with a best a guest has nowhere to keep', () => {
    render(GuestSessionSummary, { session: makeSession({ samples }), onRowAgain: vi.fn(), onExit: vi.fn() });
    expect(screen.queryByTestId('row-pb')).toBeNull();
  });
});
