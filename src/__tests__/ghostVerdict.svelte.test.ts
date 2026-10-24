import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/svelte';

import GhostVerdict from '../lib/ui/GhostVerdict.svelte';

/**
 * Issue #338 — how the race came out, on the summary (ported to Svelte for
 * #542 P1). The pace comparison #337 answers "was this a good row"; this
 * answers "did I beat the thing I was chasing", the question the row was rowed
 * to. Same copy and data-result as the React component, so the Playwright
 * racing-a-ghost selectors keep resolving.
 */
describe('the ghost verdict', () => {
  it('says the race was won, and by how much', () => {
    render(GhostVerdict, { rowSeconds: 600, ghostSeconds: 604, label: 'your best' });
    expect(screen.getByRole('status').textContent).toMatch(/beat your best by 0:04/i);
  });

  it('says it was lost, without dressing it up', () => {
    render(GhostVerdict, { rowSeconds: 610, ghostSeconds: 604, label: 'your best' });
    expect(screen.getByRole('status').textContent).toMatch(/your best was 0:06 quicker/i);
  });

  // Colour is the encouragement, never the message (#344).
  it('does not leave the result to a colour', () => {
    const { container } = render(GhostVerdict, {
      rowSeconds: 600,
      ghostSeconds: 604,
      label: 'your best',
    });
    expect(container.querySelector('[data-result="won"]')).not.toBeNull();
    expect(screen.getByText(/beat/i)).toBeTruthy();
  });

  it('calls a second either way a dead heat', () => {
    render(GhostVerdict, { rowSeconds: 600.4, ghostSeconds: 600, label: 'a 2:00 pace' });
    expect(screen.getByRole('status').textContent).toMatch(/dead heat/i);
  });

  it('names what was being chased, whatever it was', () => {
    render(GhostVerdict, { rowSeconds: 600, ghostSeconds: 620, label: 'a 2:00 pace' });
    expect(screen.getByRole('status').textContent).toMatch(/a 2:00 pace/i);
  });

  /**
   * A best over 2 km held up against a 5 km route never reached the line, so
   * there is nothing to compare; saying so beats inventing a finish.
   */
  it('says the ghost never got there rather than inventing a time', () => {
    render(GhostVerdict, { rowSeconds: 600, ghostSeconds: null, label: 'your best' });
    expect(screen.getByRole('status').textContent).toMatch(/did not reach/i);
  });

  it('says nothing at all about a row that raced nothing', () => {
    const { container } = render(GhostVerdict, {
      rowSeconds: 600,
      ghostSeconds: 604,
      label: null,
    });
    expect(container.textContent?.trim()).toBe('');
  });
});
