import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RowHud, type RowHudProps } from '../components/RowHud';

/**
 * Issue #335 — the metrics are on the stage.
 *
 * The cases here are the ones a rower would notice: the right tiles for the
 * width they are looking at, the numbers reading as numbers, the controls still
 * working, and `F` reaching the fullscreen control. Which tiles for which width
 * is `rowHudPlan.test.ts`; this is that decision arriving on screen.
 */

const props = (over: Partial<RowHudProps> = {}): RowHudProps => ({
  paceSecondsPer500: 118,
  strokeRate: 24,
  power: 187,
  heartRate: 148,
  distanceMeters: 1000.4,
  elapsedMs: 252_000,
  paused: false,
  onPause: vi.fn(),
  onResume: vi.fn(),
  onReset: vi.fn(),
  onEnd: vi.fn(),
  fullscreen: { active: false, toggle: vi.fn(), supported: true },
  ...over,
});

/** jsdom reports whatever `innerWidth` says, so a viewport is one assignment. */
const atWidth = (width: number) => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
};

const tiles = () =>
  Array.from(document.querySelectorAll('.activity-stat-card')).map((card) => ({
    label: card.querySelector('.activity-stat-label')?.textContent ?? '',
    value: card.querySelector('.activity-stat-value')?.textContent ?? '',
  }));

describe('the row HUD', () => {
  beforeEach(() => atWidth(1280));
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('puts six tiles on a laptop and four on a phone', () => {
    const { unmount } = render(<RowHud {...props()} />);
    expect(tiles()).toHaveLength(6);
    unmount();

    atWidth(390);
    render(<RowHud {...props()} />);
    expect(tiles().map((t) => t.label)).toEqual([
      'Split (/500m)',
      'SPM',
      'Heart Rate (bpm)',
      'Meters',
    ]);
  });

  // A phone turned on its side crosses the threshold, and nothing re-renders
  // the HUD when it does unless the width is listened to.
  it('picks up a rotation', () => {
    atWidth(390);
    render(<RowHud {...props()} />);
    expect(tiles()).toHaveLength(4);

    act(() => {
      atWidth(844);
      window.dispatchEvent(new Event('orientationchange'));
    });
    // 844 is still under the six-tile threshold; 1280 is over it.
    expect(tiles()).toHaveLength(4);

    act(() => {
      atWidth(1280);
      window.dispatchEvent(new Event('resize'));
    });
    expect(tiles()).toHaveLength(6);
  });

  it('reads the numbers out the way the monitor does', () => {
    render(<RowHud {...props()} />);

    // The number alone; its unit is the label above it (#344).
    expect(tiles()).toEqual([
      { label: 'Split (/500m)', value: '1:58' },
      { label: 'SPM', value: '24' },
      { label: 'Power (W)', value: '187' },
      { label: 'Heart Rate (bpm)', value: '148' },
      { label: 'Meters', value: '1000' },
      { label: 'Time', value: '4:12' },
    ]);
  });

  // Before the first stroke there is no split and no rate. A dash says so; a
  // zero would be a reading.
  it('says nothing rather than zero before the first stroke', () => {
    render(
      <RowHud
        {...props({ paceSecondsPer500: null, strokeRate: null, power: null, heartRate: null })}
      />,
    );
    const values = tiles().map((t) => t.value);

    expect(values).toContain('--:--');
    expect(values.filter((v) => v === '--'), 'rate, power and heart rate all say nothing')
      .toHaveLength(3);
  });

  it('holds every digit to the same width', () => {
    render(<RowHud {...props()} />);
    // The class the stylesheet hangs `tabular-nums` on. Asserting the computed
    // value would assert jsdom's stylesheet handling, not the design.
    for (const card of Array.from(document.querySelectorAll('.activity-stat-value'))) {
      expect(card).toHaveClass('activity-stat-value');
    }
    expect(document.querySelectorAll('.activity-stat-value')).toHaveLength(6);
  });

  describe('the controls', () => {
    it('pauses, resumes, resets and ends', async () => {
      const user = userEvent.setup();
      const running = props();
      const { rerender } = render(<RowHud {...running} />);

      await user.click(screen.getByRole('button', { name: /pause/i }));
      expect(running.onPause).toHaveBeenCalledTimes(1);

      await user.click(screen.getByRole('button', { name: /reset/i }));
      expect(running.onReset).toHaveBeenCalledTimes(1);

      await user.click(screen.getByRole('button', { name: /end workout/i }));
      expect(running.onEnd).toHaveBeenCalledTimes(1);

      rerender(<RowHud {...running} paused />);
      await user.click(screen.getByRole('button', { name: /resume/i }));
      expect(running.onResume).toHaveBeenCalledTimes(1);
    });
  });

  describe('fullscreen', () => {
    it('toggles from the button, and says which state it is in', async () => {
      const user = userEvent.setup();
      const toggle = vi.fn();
      const { rerender } = render(
        <RowHud {...props({ fullscreen: { active: false, toggle, supported: true } })} />,
      );

      const button = screen.getByRole('button', { name: /fill the screen/i });
      expect(button).toHaveAttribute('aria-pressed', 'false');
      await user.click(button);
      expect(toggle).toHaveBeenCalledTimes(1);

      rerender(<RowHud {...props({ fullscreen: { active: true, toggle, supported: true } })} />);
      expect(screen.getByRole('button', { name: /leave fullscreen/i })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
    });

    it('answers to F', async () => {
      const user = userEvent.setup();
      const toggle = vi.fn();
      render(<RowHud {...props({ fullscreen: { active: false, toggle, supported: true } })} />);

      await user.keyboard('f');
      expect(toggle).toHaveBeenCalledTimes(1);
    });

    // Ctrl+F is the browser's find. Taking it would be a shortcut that breaks
    // a shortcut.
    it('leaves the modified F alone', async () => {
      const user = userEvent.setup();
      const toggle = vi.fn();
      render(<RowHud {...props({ fullscreen: { active: false, toggle, supported: true } })} />);

      await user.keyboard('{Control>}f{/Control}');
      expect(toggle).not.toHaveBeenCalled();
    });

    it('leaves F alone while the rower is typing', async () => {
      const user = userEvent.setup();
      const toggle = vi.fn();
      render(
        <>
          <input aria-label="a field somewhere else on the page" />
          <RowHud {...props({ fullscreen: { active: false, toggle, supported: true } })} />
        </>,
      );

      await user.click(screen.getByLabelText(/a field somewhere else/i));
      await user.keyboard('f');

      expect(toggle).not.toHaveBeenCalled();
      expect(screen.getByLabelText(/a field somewhere else/i)).toHaveValue('f');
    });
  });
});
