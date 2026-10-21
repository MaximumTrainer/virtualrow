import { render, fireEvent } from '@testing-library/svelte';
import { describe, it, expect, vi } from 'vitest';

import CrewPicker from '../lib/ui/CrewPicker.svelte';
import { CREW_PREFERENCE_OPTIONS } from '../lib/ui/useCrewPreference.svelte';

// #542 P1 Row screen: CrewPicker ported to Svelte, reuses the graphics-quality
// classes, same DOM/copy.
describe('CrewPicker.svelte', () => {
  it('renders one radio button per crew option, marking the current one', () => {
    const { container } = render(CrewPicker, { preference: 'female', onChange: vi.fn() });
    expect(container.querySelector('.graphics-quality-legend')?.textContent).toBe('Rower');
    const buttons = container.querySelectorAll('.graphics-quality-option');
    expect(buttons).toHaveLength(CREW_PREFERENCE_OPTIONS.length);
    const selected = container.querySelector('.graphics-quality-option.is-selected');
    expect(selected?.textContent?.trim()).toBe('Female');
    expect(selected?.getAttribute('aria-checked')).toBe('true');
  });

  it('reports the picked preference', async () => {
    const onChange = vi.fn();
    const { container } = render(CrewPicker, { preference: 'auto', onChange });
    const male = Array.from(container.querySelectorAll('.graphics-quality-option')).find(
      (b) => b.textContent?.trim() === 'Male',
    )!;
    await fireEvent.click(male);
    expect(onChange).toHaveBeenCalledWith('male');
  });
});
