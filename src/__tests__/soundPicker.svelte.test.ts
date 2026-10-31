import { render, fireEvent } from '@testing-library/svelte';
import { describe, it, expect, vi } from 'vitest';

import SoundPicker from '../lib/ui/SoundPicker.svelte';

// #542 P1 Row screen: SoundPicker ported to Svelte, same DOM/classes/copy.
describe('SoundPicker.svelte', () => {
  it('shows only the switch when sound is off', () => {
    const { container } = render(SoundPicker, {
      enabled: false,
      volume: 0.5,
      onToggle: vi.fn(),
      onVolume: vi.fn(),
    });
    expect(container.querySelector('.sound-picker-switch span')?.textContent).toBe('Off');
    expect(container.querySelector('.sound-picker-volume')).toBeNull();
  });

  it('shows the volume slider with a percent read-out when on', () => {
    const { container } = render(SoundPicker, {
      enabled: true,
      volume: 0.35,
      onToggle: vi.fn(),
      onVolume: vi.fn(),
    });
    expect(container.querySelector('.sound-picker-switch span')?.textContent).toBe('On');
    const slider = container.querySelector('input[type="range"]') as HTMLInputElement;
    expect(slider.getAttribute('aria-valuetext')).toBe('35%');
    expect(container.querySelector('.sound-picker-volume-value')?.textContent).toBe('35%');
  });

  it('reports a toggle and a volume change', async () => {
    const onToggle = vi.fn();
    const onVolume = vi.fn();
    const { container } = render(SoundPicker, {
      enabled: true,
      volume: 0.5,
      onToggle,
      onVolume,
    });
    await fireEvent.click(container.querySelector('input[type="checkbox"]')!);
    expect(onToggle).toHaveBeenCalledWith(false);
    await fireEvent.input(container.querySelector('input[type="range"]')!, {
      target: { value: '0.8' },
    });
    expect(onVolume).toHaveBeenCalledWith(0.8);
  });
});
