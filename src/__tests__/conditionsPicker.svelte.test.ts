import { render, fireEvent } from '@testing-library/svelte';
import { describe, it, expect, vi } from 'vitest';

import ConditionsPicker from '../lib/ui/ConditionsPicker.svelte';
import { CONDITIONS, conditionsLabel } from '../components/rower3d/conditions';

// #542 P1 Row screen: ConditionsPicker ported to Svelte, same DOM/classes/copy.
describe('ConditionsPicker.svelte', () => {
  it('renders the "my clock" option plus one button per preset', () => {
    const { container } = render(ConditionsPicker, {
      choice: 'auto',
      resolved: 'midday',
      onChange: vi.fn(),
    });
    expect(container.querySelector('.conditions-picker-legend')?.textContent).toBe('Conditions');
    const options = container.querySelectorAll('.conditions-picker-option');
    expect(options).toHaveLength(CONDITIONS.length + 1);
    // auto is selected and shows what the clock resolved to.
    expect(options[0].getAttribute('aria-checked')).toBe('true');
    expect(container.querySelector('.conditions-picker-resolved')?.textContent).toContain(
      conditionsLabel('midday'),
    );
  });

  it('reports a preset choice and no longer shows the resolved hint', async () => {
    const onChange = vi.fn();
    const { container } = render(ConditionsPicker, {
      choice: 'dusk',
      resolved: 'midday',
      onChange,
    });
    expect(container.querySelector('.conditions-picker-resolved')).toBeNull();
    const dawnButton = Array.from(container.querySelectorAll('.conditions-picker-option')).find(
      (b) => b.textContent?.trim() === conditionsLabel('dawn'),
    )!;
    await fireEvent.click(dawnButton);
    expect(onChange).toHaveBeenCalledWith('dawn');
  });
});
