import { render, fireEvent } from '@testing-library/svelte';
import { describe, it, expect, vi } from 'vitest';

import RowerAppearancePicker from '../lib/ui/RowerAppearancePicker.svelte';
import {
  DEFAULT_ROWER_APPEARANCE,
  type RowerAppearancePreference,
} from '../lib/services/rowerAppearanceService';
import { TOP_PALETTE } from '../components/rower3d/rowerAppearance';

// #542 P1 Row screen: RowerAppearancePicker ported to Svelte, same DOM/testid.
describe('RowerAppearancePicker.svelte', () => {
  it('renders the disclosure with a row per appearance slot', () => {
    const { container } = render(RowerAppearancePicker, {
      appearance: DEFAULT_ROWER_APPEARANCE,
      onChange: vi.fn(),
    });
    expect(container.querySelector('details[data-testid="rower-appearance"]')).not.toBeNull();
    expect(container.querySelector('.rower-appearance-summary')?.textContent).toBe(
      'Rower appearance',
    );
    const labels = Array.from(container.querySelectorAll('.rower-appearance-label')).map((n) =>
      n.textContent,
    );
    // Default hat is 'none', so the hat-colour row is hidden.
    expect(labels).toEqual(['Top', 'Shorts', 'Shoes', 'Hair', 'Hairstyle', 'Hat']);
  });

  it('shows the hat-colour row only when a hat is worn', () => {
    const appearance: RowerAppearancePreference = { ...DEFAULT_ROWER_APPEARANCE, hat: 'cap' };
    const { container } = render(RowerAppearancePicker, { appearance, onChange: vi.fn() });
    const labels = Array.from(container.querySelectorAll('.rower-appearance-label')).map((n) =>
      n.textContent,
    );
    expect(labels).toContain('Hat colour');
  });

  it('reports a slot change when a swatch is picked', async () => {
    const onChange = vi.fn();
    const { container } = render(RowerAppearancePicker, {
      appearance: DEFAULT_ROWER_APPEARANCE,
      onChange,
    });
    // The first swatch row is "Top"; pick a colour other than the current one.
    const topRow = container.querySelector('.rower-appearance-swatches')!;
    const swatches = topRow.querySelectorAll('.rower-appearance-swatch');
    const target = TOP_PALETTE.find((o) => o.id !== DEFAULT_ROWER_APPEARANCE.top)!;
    const index = TOP_PALETTE.findIndex((o) => o.id === target.id);
    await fireEvent.click(swatches[index]);
    expect(onChange).toHaveBeenCalledWith('top', target.id);
  });
});
