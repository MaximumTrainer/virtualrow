import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CrewPicker } from '../components/CrewPicker';

describe('CrewPicker', () => {
  it('shows every choice and marks the current one', () => {
    render(<CrewPicker preference="female" onChange={() => {}} />);

    expect(screen.getByRole('radio', { name: 'Auto' })).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByRole('radio', { name: 'Female' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: 'Male' })).toHaveAttribute('aria-checked', 'false');
  });

  it('reports the rower’s choice', async () => {
    const onChange = vi.fn();
    render(<CrewPicker preference="auto" onChange={onChange} />);

    await userEvent.click(screen.getByRole('radio', { name: 'Female' }));

    expect(onChange).toHaveBeenCalledWith('female');
  });

  it('is reachable as a labelled group', () => {
    render(<CrewPicker preference="auto" onChange={() => {}} />);

    expect(screen.getByRole('radiogroup', { name: 'Rower appearance' })).toBeInTheDocument();
  });
});
