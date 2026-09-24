import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConditionsPicker } from '../components/ConditionsPicker';

/**
 * Issue #346 — picking the light a row is rowed in.
 *
 * On the route panel beside the graphics tier, because it is the same kind of
 * decision: set once, changing how every row looks, and nothing a rower wants
 * to reach for with a handle in each hand.
 */

describe('the conditions picker', () => {
  it('offers the clock and every preset', () => {
    render(<ConditionsPicker choice="auto" resolved="midday" onChange={vi.fn()} />);

    expect(screen.getByRole('radio', { name: /my clock/i })).toBeInTheDocument();
    // Exact names: the clock button carries what it resolved to, so
    // "My clock (Midday)" matches a loose /midday/ as well as "Midday" does.
    for (const name of ['Dawn', 'Midday', 'Golden hour', 'Overcast', 'Dusk']) {
      expect(screen.getByRole('radio', { name })).toBeInTheDocument();
    }
  });

  it('shows which one is in force', () => {
    render(<ConditionsPicker choice="dusk" resolved="dusk" onChange={vi.fn()} />);

    expect(screen.getByRole('radio', { name: 'Dusk' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: /my clock/i })).toHaveAttribute(
      'aria-checked',
      'false',
    );
  });

  it('hands back the preset the rower picked', async () => {
    const onChange = vi.fn();
    render(<ConditionsPicker choice="auto" resolved="midday" onChange={onChange} />);

    await userEvent.click(screen.getByRole('radio', { name: 'Golden hour' }));

    expect(onChange).toHaveBeenCalledWith('golden');
  });

  it('goes back to the clock', async () => {
    const onChange = vi.fn();
    render(<ConditionsPicker choice="dawn" resolved="dawn" onChange={onChange} />);

    await userEvent.click(screen.getByRole('radio', { name: /my clock/i }));

    expect(onChange).toHaveBeenCalledWith('auto');
  });

  /**
   * "Match my clock" is the default, so most rowers never touch this — which
   * makes *what it resolved to* the thing worth saying. Without it the panel
   * says the setting is on automatic and never says what automatic decided.
   */
  it('says what the clock resolved to', () => {
    render(<ConditionsPicker choice="auto" resolved="golden" onChange={vi.fn()} />);

    expect(screen.getByRole('radio', { name: /my clock/i })).toHaveAccessibleName(/golden hour/i);
  });

  it('says nothing about the clock once a preset overrules it', () => {
    render(<ConditionsPicker choice="dusk" resolved="dusk" onChange={vi.fn()} />);

    expect(screen.getByRole('radio', { name: /my clock/i })).not.toHaveAccessibleName(/dusk.*dusk/i);
  });

  it('is a radio group a screen reader can read as one', () => {
    render(<ConditionsPicker choice="auto" resolved="midday" onChange={vi.fn()} />);

    expect(screen.getByRole('radiogroup', { name: /conditions/i })).toBeInTheDocument();
  });
});
