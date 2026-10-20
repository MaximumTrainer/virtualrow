import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { RowerAppearancePicker } from '../components/RowerAppearancePicker';
import { DEFAULT_ROWER_APPEARANCE } from '../lib/services/rowerAppearanceService';
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
    expect(screen.getByRole('radiogroup', { name: 'Hairstyle' })).toBeDefined();
    expect(screen.getByRole('radiogroup', { name: 'Hat' })).toBeDefined();
  });

  it('hides the hat colour row when the hat is none and shows it when a hat is picked', () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <RowerAppearancePicker
        appearance={DEFAULT_ROWER_APPEARANCE}
        onChange={onChange}
      />,
    );
    expect(screen.queryByRole('radiogroup', { name: 'Hat colour' })).toBeNull();

    rerender(
      <RowerAppearancePicker
        appearance={{ ...DEFAULT_ROWER_APPEARANCE, hat: 'cap' }}
        onChange={onChange}
      />,
    );
    expect(screen.getByRole('radiogroup', { name: 'Hat colour' })).toBeDefined();
  });

  it('calls onChange when a hairstyle option is picked', () => {
    const onChange = vi.fn();
    render(
      <RowerAppearancePicker
        appearance={DEFAULT_ROWER_APPEARANCE}
        onChange={onChange}
      />,
    );
    const hairstyleGroup = screen.getByRole('radiogroup', { name: 'Hairstyle' });
    const longChip = hairstyleGroup.querySelector('[aria-label="Long"]')!;
    fireEvent.click(longChip);
    expect(onChange).toHaveBeenCalledWith('hairstyle', 'long');
  });

  it('calls onChange when a hat option is picked', () => {
    const onChange = vi.fn();
    render(
      <RowerAppearancePicker
        appearance={DEFAULT_ROWER_APPEARANCE}
        onChange={onChange}
      />,
    );
    const hatGroup = screen.getByRole('radiogroup', { name: 'Hat' });
    const beanieChip = hatGroup.querySelector('[aria-label="Beanie"]')!;
    fireEvent.click(beanieChip);
    expect(onChange).toHaveBeenCalledWith('hat', 'beanie');
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
