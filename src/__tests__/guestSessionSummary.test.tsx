import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GuestSessionSummary } from '../components/GuestSessionSummary';
import type { WorkoutSession } from '../types/index';

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
    render(
      <GuestSessionSummary
        session={makeSession({ heartRateAvg: 145, heartRateMax: 162 })}
        onRowAgain={vi.fn()}
        onExit={vi.fn()}
      />,
    );

    const copy = screen.getByText(/signing in with intervals\.icu/i);
    expect(copy).toHaveTextContent(/distance/i);
    expect(copy).toHaveTextContent(/time/i);
    expect(copy).toHaveTextContent(/average pace/i);
    expect(copy).toHaveTextContent(/calories/i);
    expect(copy).toHaveTextContent(/heart rate/i);
  });

  it('omits heart rate from the list when the session captured none', () => {
    render(
      <GuestSessionSummary session={makeSession()} onRowAgain={vi.fn()} onExit={vi.fn()} />,
    );

    const copy = screen.getByText(/signing in with intervals\.icu/i);
    expect(copy).toHaveTextContent(/calories/i);
    expect(copy).not.toHaveTextContent(/heart rate/i);
  });

  it('states plainly that the session was not saved', () => {
    render(<GuestSessionSummary session={makeSession()} onRowAgain={vi.fn()} onExit={vi.fn()} />);
    expect(screen.getByText(/has not been saved/i)).toBeInTheDocument();
  });

  it('marks a demo row as simulated so it is never read as a real session (TD-2)', () => {
    render(<GuestSessionSummary session={makeSession()} onRowAgain={vi.fn()} onExit={vi.fn()} isDemo />);

    expect(screen.getByText('Demo Row')).toBeInTheDocument();
    expect(screen.getByText(/demo on simulated data/i)).toBeInTheDocument();
  });

  it('labels a non-demo session as a guest session', () => {
    render(<GuestSessionSummary session={makeSession()} onRowAgain={vi.fn()} onExit={vi.fn()} />);
    expect(screen.getByText('Guest Session')).toBeInTheDocument();
  });

  it('offers sign-in when a handler is supplied, and calls it', async () => {
    const user = userEvent.setup();
    const onSignIn = vi.fn();
    render(
      <GuestSessionSummary session={makeSession()} onRowAgain={vi.fn()} onExit={vi.fn()} onSignIn={onSignIn} />,
    );

    await user.click(screen.getByRole('button', { name: /sign in to save future rows/i }));
    expect(onSignIn).toHaveBeenCalledTimes(1);
  });

  it('omits the sign-in control when no handler is supplied', () => {
    render(<GuestSessionSummary session={makeSession()} onRowAgain={vi.fn()} onExit={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /sign in/i })).toBeNull();
  });

  it('still offers Row Again and Done', async () => {
    const user = userEvent.setup();
    const onRowAgain = vi.fn();
    const onExit = vi.fn();
    render(<GuestSessionSummary session={makeSession()} onRowAgain={onRowAgain} onExit={onExit} />);

    await user.click(screen.getByRole('button', { name: /row again/i }));
    await user.click(screen.getByRole('button', { name: /done/i }));
    expect(onRowAgain).toHaveBeenCalledTimes(1);
    expect(onExit).toHaveBeenCalledTimes(1);
  });
});
