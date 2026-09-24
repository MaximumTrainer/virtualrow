import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GhostPicker, type GhostChoice } from '../components/GhostPicker';
import { parsePaceInput } from '../utils/paceInput';

/**
 * Issue #338 — deciding what to race, before the row starts.
 *
 * The choice belongs on the route panel rather than mid-row: a rower with a
 * handle in each hand cannot set a target pace, and a ghost that appeared after
 * the start would be racing from behind through no fault of anyone's.
 */

const alone: GhostChoice = { kind: 'none' };

const picker = (over: Partial<React.ComponentProps<typeof GhostPicker>> = {}) => {
  const onChange = vi.fn();
  render(<GhostPicker value={alone} onChange={onChange} hasBest={true} bestPace={125} {...over} />);
  return onChange;
};

describe('the ghost picker', () => {
  it('offers rowing alone, racing your best, and a pace boat', () => {
    picker();

    expect(screen.getByRole('radio', { name: /row alone/i })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /my best/i })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /pace boat/i })).toBeInTheDocument();
  });

  it('starts on rowing alone, which is what the app did before', () => {
    picker();

    expect(screen.getByRole('radio', { name: /row alone/i })).toBeChecked();
  });

  it('says what pace the best it would race was rowed at', () => {
    picker();

    expect(screen.getByRole('radio', { name: /my best/i })).toHaveAccessibleName(/2:05/);
  });

  /**
   * A first row on a route has nothing to race.
   *
   * Disabled with the reason on it rather than hidden: an option that vanishes
   * looks like a feature that is not there, and the rower has done nothing
   * wrong - they simply have not rowed here before.
   */
  it('cannot race a best that does not exist, and says why', () => {
    picker({ hasBest: false, bestPace: null });

    const best = screen.getByRole('radio', { name: /my best/i });
    expect(best).toBeDisabled();
    expect(screen.getByText(/first row on this route/i)).toBeInTheDocument();
  });

  it('hands back the choice the rower made', async () => {
    const onChange = picker();

    await userEvent.click(screen.getByRole('radio', { name: /my best/i }));

    expect(onChange).toHaveBeenCalledWith({ kind: 'best' });
  });

  it('asks for a pace only once a pace boat is what is wanted', async () => {
    const onChange = picker();

    expect(screen.queryByLabelText(/target pace/i)).toBeNull();

    await userEvent.click(screen.getByRole('radio', { name: /pace boat/i }));

    expect(onChange).toHaveBeenCalledWith({ kind: 'pace', paceSPer500: expect.any(Number) });
  });

  it('takes a target pace as a rower says it', async () => {
    const onChange = vi.fn();
    render(
      <GhostPicker
        value={{ kind: 'pace', paceSPer500: 120 }}
        onChange={onChange}
        hasBest
        bestPace={125}
      />,
    );

    const field = screen.getByLabelText(/target pace/i);
    await userEvent.clear(field);
    await userEvent.type(field, '2:05');

    expect(onChange).toHaveBeenLastCalledWith({ kind: 'pace', paceSPer500: 125 });
  });

  // A half-typed "2:" is not a pace, and a boat that jumped to 2 s/500 m the
  // moment the colon was typed would be gone over the horizon.
  it('leaves the boat where it is while a pace is half typed', async () => {
    const onChange = vi.fn();
    render(
      <GhostPicker
        value={{ kind: 'pace', paceSPer500: 120 }}
        onChange={onChange}
        hasBest
        bestPace={125}
      />,
    );

    const field = screen.getByLabelText(/target pace/i);
    await userEvent.clear(field);
    await userEvent.type(field, '2:');

    expect(onChange).not.toHaveBeenCalledWith({ kind: 'pace', paceSPer500: 2 });
  });
});

describe('reading a pace a rower typed', () => {
  it('reads mm:ss', () => {
    expect(parsePaceInput('2:05')).toBe(125);
    expect(parsePaceInput('1:45')).toBe(105);
  });

  it('tolerates the spaces and the stray unit a rower types', () => {
    expect(parsePaceInput(' 2:05 ')).toBe(125);
  });

  it('refuses what is not a pace', () => {
    expect(parsePaceInput('')).toBeNull();
    expect(parsePaceInput('2:')).toBeNull();
    expect(parsePaceInput('abc')).toBeNull();
    expect(parsePaceInput('2:75')).toBeNull();
  });

  /**
   * A pace boat at 0:30/500 m is 16 m/s — a speedboat. At 9:59 it is slower
   * than the current. Neither is a rower, and both come from a typo.
   */
  it('refuses a pace no boat rows', () => {
    expect(parsePaceInput('0:30')).toBeNull();
    expect(parsePaceInput('9:30')).toBeNull();
  });
});
