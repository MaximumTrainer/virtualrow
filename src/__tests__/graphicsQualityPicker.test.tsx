import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GraphicsQualityPicker } from '../components/GraphicsQualityPicker';

describe('GraphicsQualityPicker', () => {
  it('offers the tiers as a labelled radio group', () => {
    render(<GraphicsQualityPicker quality="auto" onChange={vi.fn()} />);

    const group = screen.getByRole('radiogroup', { name: /graphics quality/i });
    expect(group).toBeInTheDocument();
    // #455 FR6: six options — auto plus the five tiers (basic/low/medium/high/extra-high).
    expect(screen.getAllByRole('radio')).toHaveLength(6);
  });

  it('marks the current choice as checked, and only that one', () => {
    render(<GraphicsQualityPicker quality="basic" onChange={vi.fn()} />);

    expect(screen.getByRole('radio', { name: 'Basic' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Auto' })).not.toBeChecked();
    expect(screen.getByRole('radio', { name: 'Extra High' })).not.toBeChecked();
  });

  it('reports the tier the rower picked', async () => {
    const onChange = vi.fn();
    render(<GraphicsQualityPicker quality="auto" onChange={onChange} />);

    await userEvent.click(screen.getByRole('radio', { name: 'Extra High' }));
    expect(onChange).toHaveBeenCalledWith('extra-high');
  });

  it('explains what each tier does', () => {
    render(<GraphicsQualityPicker quality="auto" onChange={vi.fn()} />);
    expect(screen.getByRole('radio', { name: 'Auto' })).toHaveAttribute(
      'title',
      'Match the graphics card',
    );
    expect(screen.getByRole('radio', { name: 'Basic' })).toHaveAttribute(
      'title',
      'No shadows or effects',
    );
  });
});
