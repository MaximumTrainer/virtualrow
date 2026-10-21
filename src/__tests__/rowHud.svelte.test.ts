import { render, fireEvent } from '@testing-library/svelte';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import RowHud from '../lib/ui/RowHud.svelte';
import type { FullscreenControl } from '../lib/ui/fullscreenControl';

const fullscreen = (over: Partial<FullscreenControl> = {}): FullscreenControl => ({
  active: false,
  toggle: vi.fn(),
  supported: true,
  ...over,
});

/** The props the HUD needs, with live numbers unless a test overrides them. */
function props(over: Record<string, unknown> = {}) {
  return {
    paceSecondsPer500: 120,
    strokeRate: 28,
    power: 187,
    heartRate: 150,
    distanceMeters: 1234.6,
    elapsedMs: 65_000,
    paused: false,
    onPause: vi.fn(),
    onResume: vi.fn(),
    onReset: vi.fn(),
    onEnd: vi.fn(),
    fullscreen: fullscreen(),
    ghost: null,
    ...over,
  };
}

function setViewport(width: number): void {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: width });
}

// #542 P1 workout view: RowHud ported to Svelte, DOM/classes/copy verbatim.
describe('RowHud.svelte', () => {
  beforeEach(() => {
    setViewport(1280);
  });

  it('shows all six stat tiles on a wide stage', () => {
    setViewport(1280);
    const { container } = render(RowHud, props());
    const labels = [...container.querySelectorAll('.activity-stat-label')].map((n) => n.textContent);
    expect(labels).toEqual(['Split (/500m)', 'SPM', 'Power (W)', 'Heart Rate (bpm)', 'Meters', 'Time']);
  });

  it('drops to four tiles on a phone-width stage', () => {
    setViewport(390);
    const { container } = render(RowHud, props());
    const labels = [...container.querySelectorAll('.activity-stat-label')].map((n) => n.textContent);
    expect(labels).toEqual(['Split (/500m)', 'SPM', 'Heart Rate (bpm)', 'Meters']);
  });

  it('formats each live number for its tile', () => {
    const { container } = render(RowHud, props());
    const values = [...container.querySelectorAll('.activity-stat-value')].map((n) => n.textContent);
    // split 2:00, spm 28, power 187, hr 150, distance rounds 1234.6 -> 1235, time 1:05
    expect(values).toEqual(['2:00', '28', '187', '150', '1235', '1:05']);
  });

  it('renders placeholders for missing readings before the first stroke', () => {
    const { container } = render(
      RowHud,
      props({ paceSecondsPer500: null, strokeRate: null, power: null, heartRate: null }),
    );
    const values = [...container.querySelectorAll('.activity-stat-value')].map((n) => n.textContent);
    expect(values[0]).toBe('--:--'); // split
    expect(values[1]).toBe('--'); // spm
    expect(values[2]).toBe('--'); // power
    expect(values[3]).toBe('--'); // hr
  });

  it('swaps Pause for Resume when paused and reports each control', async () => {
    const onPause = vi.fn();
    const onResume = vi.fn();
    const onReset = vi.fn();
    const onEnd = vi.fn();

    const running = render(RowHud, props({ paused: false, onPause, onResume, onReset, onEnd }));
    const control = running.container.querySelector('.btn-activity-control') as HTMLButtonElement;
    expect(control.textContent?.trim()).toBe('⏸ Pause');
    await fireEvent.click(control);
    expect(onPause).toHaveBeenCalledOnce();

    await fireEvent.click(running.container.querySelector('.btn-activity-control--subtle') as HTMLButtonElement);
    expect(onReset).toHaveBeenCalledOnce();
    await fireEvent.click(running.container.querySelector('.btn-end-workout') as HTMLButtonElement);
    expect(onEnd).toHaveBeenCalledOnce();

    const paused = render(RowHud, props({ paused: true, onResume }));
    const resume = paused.container.querySelector('.btn-activity-control') as HTMLButtonElement;
    expect(resume.textContent?.trim()).toBe('▶ Resume');
    await fireEvent.click(resume);
    expect(onResume).toHaveBeenCalledOnce();
  });

  it('labels the fullscreen button for each state and toggles it', async () => {
    const toggle = vi.fn();
    const inactive = render(RowHud, props({ fullscreen: fullscreen({ active: false, toggle }) }));
    const button = inactive.container.querySelector('.btn-hud-fullscreen') as HTMLButtonElement;
    expect(button.getAttribute('aria-pressed')).toBe('false');
    expect(button.getAttribute('aria-label')).toBe('Fill the screen with the row');
    await fireEvent.click(button);
    expect(toggle).toHaveBeenCalledOnce();

    const active = render(RowHud, props({ fullscreen: fullscreen({ active: true }) }));
    const pressed = active.container.querySelector('.btn-hud-fullscreen') as HTMLButtonElement;
    expect(pressed.getAttribute('aria-pressed')).toBe('true');
    expect(pressed.getAttribute('aria-label')).toBe('Leave fullscreen');
  });

  it('toggles fullscreen on the F shortcut, but not while typing', () => {
    const toggle = vi.fn();
    render(RowHud, props({ fullscreen: fullscreen({ toggle }) }));

    // A real keydown targets an element and bubbles up to the window listener.
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', bubbles: true }));
    expect(toggle).toHaveBeenCalledOnce();

    // A modifier means a browser shortcut, not ours.
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', metaKey: true, bubbles: true }));
    expect(toggle).toHaveBeenCalledOnce();

    // Inside a field the key types an f; the shortcut stands down.
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', bubbles: true }));
    expect(toggle).toHaveBeenCalledOnce();
    input.remove();
  });

  it('hides the ghost gap when rowing alone or before the row starts', () => {
    const alone = render(RowHud, props({ ghost: null }));
    expect(alone.container.querySelector('.row-hud-gap')).toBeNull();

    const onLine = render(RowHud, props({ ghost: { gapMeters: null, label: 'your best' } }));
    expect(onLine.container.querySelector('.row-hud-gap')).toBeNull();
  });

  it('reads the gap with its lead in the sign and the data attribute', () => {
    const ahead = render(RowHud, props({ ghost: { gapMeters: 12, label: 'your best' } }));
    const aheadGap = ahead.container.querySelector('.row-hud-gap') as HTMLElement;
    expect(aheadGap.getAttribute('data-lead')).toBe('ahead');
    expect(aheadGap.querySelector('.row-hud-gap-value')?.textContent).toBe('+12 m');
    expect(aheadGap.querySelector('.row-hud-gap-label')?.textContent).toBe('on your best');

    const behind = render(RowHud, props({ ghost: { gapMeters: -8, label: '5:00 pace' } }));
    const behindGap = behind.container.querySelector('.row-hud-gap') as HTMLElement;
    expect(behindGap.getAttribute('data-lead')).toBe('behind');
    expect(behindGap.querySelector('.row-hud-gap-value')?.textContent).toBe('−8 m');

    const level = render(RowHud, props({ ghost: { gapMeters: 0.4, label: 'your best' } }));
    const levelGap = level.container.querySelector('.row-hud-gap') as HTMLElement;
    expect(levelGap.getAttribute('data-lead')).toBe('level');
    expect(levelGap.querySelector('.row-hud-gap-value')?.textContent).toBe('level');
  });
});
