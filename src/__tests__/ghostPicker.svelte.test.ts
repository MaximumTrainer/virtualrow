import { render, screen, fireEvent } from '@testing-library/svelte';
import { describe, it, expect, vi } from 'vitest';

import GhostPicker from '../lib/ui/GhostPicker.svelte';
import type { GhostChoice } from '../lib/ui/ghostChoice';

// #542 P1 Row screen: GhostPicker ported to Svelte, same DOM/classes/copy.
describe('GhostPicker.svelte', () => {
  it('renders the three ghost options under one radio group', () => {
    const { container } = render(GhostPicker, {
      value: { kind: 'none' } as GhostChoice,
      onChange: vi.fn(),
      hasBest: true,
      bestPace: 120,
    });
    expect(container.querySelector('.ghost-picker-legend')?.textContent).toBe('Row against');
    const radios = container.querySelectorAll('input[type="radio"][name="ghost"]');
    expect(radios).toHaveLength(3);
    expect(screen.getByText('Row alone')).toBeTruthy();
    expect(screen.getByText('Pace boat')).toBeTruthy();
    // The best split shows beside "Race my best" when there is one.
    expect(container.querySelector('.ghost-picker-detail')?.textContent).toContain('/500m');
  });

  it('disables "race my best" and shows the hint with no recorded row', () => {
    const { container } = render(GhostPicker, {
      value: { kind: 'none' } as GhostChoice,
      onChange: vi.fn(),
      hasBest: false,
      bestPace: null,
    });
    const radios = container.querySelectorAll('input[type="radio"][name="ghost"]');
    expect((radios[1] as HTMLInputElement).disabled).toBe(true);
    expect(container.querySelector('.ghost-picker-hint')).not.toBeNull();
  });

  it('reports the chosen kind', async () => {
    const onChange = vi.fn();
    const { container } = render(GhostPicker, {
      value: { kind: 'none' } as GhostChoice,
      onChange,
      hasBest: true,
      bestPace: 120,
    });
    const radios = container.querySelectorAll('input[type="radio"][name="ghost"]');
    await fireEvent.change(radios[1]);
    expect(onChange).toHaveBeenCalledWith({ kind: 'best' });
  });

  it('hides the best split when there is a best but no recorded pace', () => {
    const { container } = render(GhostPicker, {
      value: { kind: 'none' } as GhostChoice,
      onChange: vi.fn(),
      hasBest: true,
      bestPace: null,
    });
    // hasBest is true but bestPace is null, so the split detail is not shown.
    expect(container.querySelector('.ghost-picker-detail')).toBeNull();
    expect(container.querySelector('.ghost-picker-hint')).toBeNull();
  });

  it('shows the target-pace field only for the pace option and parses input', async () => {
    const onChange = vi.fn();
    const { container } = render(GhostPicker, {
      value: { kind: 'pace', paceSPer500: 120 } as GhostChoice,
      onChange,
      hasBest: false,
      bestPace: null,
    });
    const field = container.querySelector('.ghost-picker-pace-field') as HTMLInputElement;
    expect(field).not.toBeNull();
    await fireEvent.input(field, { target: { value: '1:45' } });
    expect(onChange).toHaveBeenCalledWith({ kind: 'pace', paceSPer500: 105 });
  });
});
