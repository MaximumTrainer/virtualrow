import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PersonalBestLine } from '../components/PersonalBestLine';

/**
 * Issue #337 — today's row against the rower's best on this route.
 *
 * The summary reported a time and a distance and nothing to measure them
 * against, so a rower could not tell a good row from an ordinary one without
 * remembering their own history.
 */
describe('the personal best line', () => {
  it('says how much quicker today was', () => {
    render(<PersonalBestLine averagePace={118} best={125} />);

    expect(screen.getByText(/faster today/i)).toBeInTheDocument();
    expect(screen.getByText('2:05/500m')).toBeInTheDocument();
    expect(screen.getByText(/0:07/)).toBeInTheDocument();
  });

  it('says how much slower, without dressing it up', () => {
    render(<PersonalBestLine averagePace={130} best={125} />);

    expect(screen.getByText(/slower today/i)).toBeInTheDocument();
    expect(screen.getByText(/0:05/)).toBeInTheDocument();
  });

  /**
   * Colour is the encouragement, never the message (#344).
   *
   * The result is in words as well as in the border colour, so a rower who
   * cannot tell the greens from the greys reads the same thing. `data-result`
   * is what the stylesheet hangs the colour on; the text is what is read.
   */
  it('does not leave the result to a colour', () => {
    const { container } = render(<PersonalBestLine averagePace={118} best={125} />);

    expect(container.querySelector('[data-result="faster"]')).not.toBeNull();
    expect(screen.getByText(/faster today/i)).toBeInTheDocument();
  });

  // A first row on a route is not a defeat, and "+0:00" would imply one.
  it('welcomes a first row rather than scoring it', () => {
    render(<PersonalBestLine averagePace={120} best={null} />);

    expect(screen.getByText(/first row on this route/i)).toBeInTheDocument();
    expect(screen.queryByText(/slower/i)).toBeNull();
    expect(screen.queryByText(/faster/i)).toBeNull();
  });

  // Half a second either way is not a personal best story.
  it('calls a dead heat a dead heat', () => {
    render(<PersonalBestLine averagePace={125.4} best={125} />);

    expect(screen.getByText(/matched to the second/i)).toBeInTheDocument();
    expect(screen.queryByText(/slower today/i)).toBeNull();
  });

  it('spells the sign out rather than printing a bare minus', () => {
    render(<PersonalBestLine averagePace={118} best={125} />);

    // "−0:07 faster today", not "-7".
    expect(screen.getByText(/0:07 faster today/i)).toBeInTheDocument();
  });
});
