import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { GhostVerdict } from '../components/GhostVerdict';

/**
 * Issue #338 — how the race came out, on the summary.
 *
 * The rower watched a gap all the way down the course; the summary is where
 * it is settled. The pace comparison #337 puts here answers "was this a good
 * row"; this answers "did I beat the thing I was chasing", which is the
 * question the row was actually rowed to.
 */

describe('the ghost verdict', () => {
  it('says the race was won, and by how much', () => {
    render(<GhostVerdict rowSeconds={600} ghostSeconds={604} label="your best" />);

    expect(screen.getByRole('status')).toHaveTextContent(/beat your best by 0:04/i);
  });

  it('says it was lost, without dressing it up', () => {
    render(<GhostVerdict rowSeconds={610} ghostSeconds={604} label="your best" />);

    expect(screen.getByRole('status')).toHaveTextContent(/your best was 0:06 quicker/i);
  });

  // Colour is the encouragement, never the message (#344).
  it('does not leave the result to a colour', () => {
    const { container } = render(
      <GhostVerdict rowSeconds={600} ghostSeconds={604} label="your best" />,
    );

    expect(container.querySelector('[data-result="won"]')).not.toBeNull();
    expect(screen.getByText(/beat/i)).toBeInTheDocument();
  });

  it('calls a second either way a dead heat', () => {
    render(<GhostVerdict rowSeconds={600.4} ghostSeconds={600} label="a 2:00 pace" />);

    expect(screen.getByRole('status')).toHaveTextContent(/dead heat/i);
  });

  it('names what was being chased, whatever it was', () => {
    render(<GhostVerdict rowSeconds={600} ghostSeconds={620} label="a 2:00 pace" />);

    expect(screen.getByRole('status')).toHaveTextContent(/a 2:00 pace/i);
  });

  /**
   * A best over 2 km held up against a 5 km route never reached the line, so
   * there is no time at which it got there and nothing to compare. Saying so
   * beats inventing a finish by extrapolating a pace nobody rowed.
   */
  it('says the ghost never got there rather than inventing a time', () => {
    render(<GhostVerdict rowSeconds={600} ghostSeconds={null} label="your best" />);

    expect(screen.getByRole('status')).toHaveTextContent(/did not reach/i);
  });

  it('says nothing at all about a row that raced nothing', () => {
    const { container } = render(
      <GhostVerdict rowSeconds={600} ghostSeconds={604} label={null} />,
    );

    expect(container).toBeEmptyDOMElement();
  });
});
