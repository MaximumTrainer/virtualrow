import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { RowerAppearancePicker } from '../components/RowerAppearancePicker';
import { DEFAULT_ROWER_APPEARANCE } from '../services/rowerAppearanceService';
import { TOP_PALETTE, HAIR_PALETTE } from '../components/rower3d/rowerAppearance';

describe('RowerAppearancePicker', () => {
  it('renders a chip row for every colourable slot', () => {
    const onChange = vi.fn();
    render(
      <RowerAppearancePicker
        appearance={DEFAULT_ROWER_APPEARANCE}
        onChange={onChange}
      />,
    );
    expect(screen.getByRole('radiogroup', { name: 'Top' })).toBeDefined();
    expect(screen.getByRole('radiogroup', { name: 'Shorts' })).toBeDefined();
    expect(screen.getByRole('radiogroup', { name: 'Shoes' })).toBeDefined();
    expect(screen.getByRole('radiogroup', { name: 'Hair' })).toBeDefined();
  });

  it('calls onChange with the slot id when a swatch is clicked', () => {
    const onChange = vi.fn();
    render(
      <RowerAppearancePicker
        appearance={DEFAULT_ROWER_APPEARANCE}
        onChange={onChange}
      />,
    );
    const topGroup = screen.getByRole('radiogroup', { name: 'Top' });
    const red = TOP_PALETTE.find((option) => option.id === 'red')!;
    const redSwatch = topGroup.querySelector(`[aria-label="${red.label}"]`)!;
    fireEvent.click(redSwatch);
    expect(onChange).toHaveBeenCalledWith('top', 'red');
  });

  it('marks the selected swatch with aria-checked', () => {
    const { rerender } = render(
      <RowerAppearancePicker
        appearance={{ ...DEFAULT_ROWER_APPEARANCE, hair: 'blond' }}
        onChange={() => {}}
      />,
    );
    const hairGroup = screen.getByRole('radiogroup', { name: 'Hair' });
    const blond = HAIR_PALETTE.find((option) => option.id === 'blond')!;
    const black = HAIR_PALETTE.find((option) => option.id === 'black')!;
    expect(
      hairGroup.querySelector(`[aria-label="${blond.label}"]`)?.getAttribute('aria-checked'),
    ).toBe('true');
    expect(
      hairGroup.querySelector(`[aria-label="${black.label}"]`)?.getAttribute('aria-checked'),
    ).toBe('false');

    rerender(
      <RowerAppearancePicker
        appearance={{ ...DEFAULT_ROWER_APPEARANCE, hair: 'black' }}
        onChange={() => {}}
      />,
    );
    expect(
      hairGroup.querySelector(`[aria-label="${black.label}"]`)?.getAttribute('aria-checked'),
    ).toBe('true');
  });
});
