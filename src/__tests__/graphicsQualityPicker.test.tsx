import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GraphicsQualityPicker } from '../components/GraphicsQualityPicker';

describe('GraphicsQualityPicker', () => {
  it('offers the tiers as a labelled radio group', () => {
    render(<GraphicsQualityPicker quality="auto" onChange={vi.fn()} />);

    const group = screen.getByRole('radiogroup', { name: /graphics quality/i });
    expect(group).toBeInTheDocument();
    expect(screen.getAllByRole('radio')).toHaveLength(3);
  });

  it('marks the current choice as checked, and only that one', () => {
    render(<GraphicsQualityPicker quality="low" onChange={vi.fn()} />);

    expect(screen.getByRole('radio', { name: 'Low' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Auto' })).not.toBeChecked();
    expect(screen.getByRole('radio', { name: 'High' })).not.toBeChecked();
  });

  it('reports the tier the rower picked', async () => {
    const onChange = vi.fn();
    render(<GraphicsQualityPicker quality="auto" onChange={onChange} />);

    await userEvent.click(screen.getByRole('radio', { name: 'High' }));
    expect(onChange).toHaveBeenCalledWith('high');
  });

  it('explains what each tier does', () => {
    render(<GraphicsQualityPicker quality="auto" onChange={vi.fn()} />);
    expect(screen.getByRole('radio', { name: 'Auto' })).toHaveAttribute(
      'title',
      'Match the graphics card',
    );
    expect(screen.getByRole('radio', { name: 'Low' })).toHaveAttribute(
      'title',
      'No shadows or effects',
    );
  });
});
