import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { RouteLoadingBar } from '../components/RouteLoadingBar';
import { describeLoadProgress, type LoadPhaseKey } from '../utils/loadingProgress';

/**
 * What the rower sees while the route loads (#318).
 *
 * `loadingProgress.test.ts` proves the arithmetic. This proves the two things
 * the component decides for itself, both of which were wrong first time:
 *
 *   - the bar is removed when the wait is over, and completion and removal
 *     happened in the same render, so it went 45% -> gone and never showed the
 *     finish. The E2E caught that; this pins it.
 *   - a boat that could not be fetched is still true after the bar has gone,
 *     and the rower is about to notice a river with no boat in it.
 */

const progress = (finished: LoadPhaseKey[], failed: LoadPhaseKey[] = []) =>
  describeLoadProgress(new Set(finished), new Set(failed));

const ALL: LoadPhaseKey[] = ['view', 'scene', 'frame', 'boat'];

afterEach(() => {
  vi.useRealTimers();
});

describe('RouteLoadingBar', () => {
  it('tells everyone the same number, including a screen reader', () => {
    render(<RouteLoadingBar progress={progress(['view'])} />);

    const bar = screen.getByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuemin', '0');
    expect(bar).toHaveAttribute('aria-valuemax', '100');
    expect(bar).toHaveAttribute('aria-valuenow', '20');
    expect(bar).toHaveAccessibleName('Loading the 3D view');
  });

  it('says what it is waiting for, not just how far along it is', () => {
    render(<RouteLoadingBar progress={progress(['view'])} />);

    expect(screen.getByRole('progressbar')).toHaveAttribute(
      'aria-valuetext',
      'Preparing the scene',
    );
  });

  it('shows the finish before it goes', () => {
    vi.useFakeTimers();
    // The real sequence: the bar is up, and then the last phase lands. Mounting
    // it already-complete is a different case, covered below - there is nothing
    // to show a rower who never waited.
    const { rerender } = render(
      <RouteLoadingBar progress={progress(['view', 'scene', 'frame'])} />,
    );
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '45');

    rerender(<RouteLoadingBar progress={progress(ALL)} />);

    // The fault this exists to prevent: completion and removal in one render,
    // so the bar jumped from 45% straight to nothing and never showed the
    // finish. The E2E caught that; this pins it.
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100');

    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('stays while anything is outstanding, however long that is', () => {
    vi.useFakeTimers();
    render(<RouteLoadingBar progress={progress(['view', 'scene', 'frame'])} />);

    act(() => {
      vi.advanceTimersByTime(60_000);
    });

    // 45%: the boat has not arrived, and the boat is most of the wait.
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '45');
  });

  it('explains a boat that could not be fetched', () => {
    render(<RouteLoadingBar progress={progress(['view', 'scene', 'frame'], ['boat'])} />);

    expect(screen.getByText(/The boat could not be loaded/i)).toBeInTheDocument();
  });

  it('keeps explaining it after the bar has gone', () => {
    vi.useFakeTimers();
    render(<RouteLoadingBar progress={progress(['view', 'scene', 'frame'], ['boat'])} />);

    act(() => {
      vi.advanceTimersByTime(500);
    });

    // The bar's job is done - the wait really is over - but the river still
    // has no boat in it and the rower is owed the reason.
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(screen.getByText(/The boat could not be loaded/i)).toBeInTheDocument();
  });

  it('shows nothing at all once a clean load has finished', () => {
    vi.useFakeTimers();
    const { container } = render(<RouteLoadingBar progress={progress(ALL)} />);

    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(container).toBeEmptyDOMElement();
  });
});
