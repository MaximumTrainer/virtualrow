import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, act, within } from '@testing-library/react';
import { RowHud, type RowHudProps } from '../components/RowHud';
import { metricTiles } from '../components/rowHudTiles';

/**
 * Issue #335 — the metrics are on the stage.
 *
 * On a phone propped on the erg the eight stat cards sat below the fold. The
 * HUD carries the ones a rower reads mid-stroke, as many as the width has room
 * for, in type sized to be read from the seat.
 */

const setWidth = (width: number) => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
  act(() => {
    window.dispatchEvent(new Event('resize'));
  });
};

const props = (overrides: Partial<RowHudProps> = {}): RowHudProps => ({
  pace: 118,
  spm: 24,
  power: 187,
  heartRate: 148,
  distance: 1000.4,
  elapsedMs: 252_000,
  paused: false,
  onPause: vi.fn(),
  onResume: vi.fn(),
  onReset: vi.fn(),
  onEnd: vi.fn(),
  fullscreen: { active: false, toggle: vi.fn() },
  ...overrides,
});

const tileLabels = () =>
  screen.getAllByTestId('row-hud-tile').map((t) => within(t).getByText(/./, { selector: '.activity-stat-label' }).textContent);

afterEach(() => {
  setWidth(1024);
});

describe('metricTiles', () => {
  it('shows six tiles where there is room for them', () => {
    expect(metricTiles(1280)).toEqual(['split', 'spm', 'power', 'heartRate', 'distance', 'time']);
    expect(metricTiles(900)).toHaveLength(6);
  });

  it('keeps the four a rower reads mid-stroke on a phone', () => {
    expect(metricTiles(390)).toEqual(['split', 'spm', 'heartRate', 'distance']);
    expect(metricTiles(899)).toHaveLength(4);
  });
});

describe('RowHud', () => {
  it('renders six tiles at 1280px and four at 390px', () => {
    setWidth(1280);
    render(<RowHud {...props()} />);
    expect(tileLabels()).toEqual(['Split', 'SPM', 'Power', 'Heart Rate', 'Meters', 'Time']);

    setWidth(390);
    expect(tileLabels()).toEqual(['Split', 'SPM', 'Heart Rate', 'Meters']);
  });

  it('shows each value with its unit', () => {
    setWidth(1280);
    render(<RowHud {...props()} />);
    const value = (label: string) =>
      screen
        .getAllByTestId('row-hud-tile')
        .find((t) => t.querySelector('.activity-stat-label')?.textContent === label)!
        .querySelector('.activity-stat-value')!.textContent;

    expect(value('Split')).toBe('1:58/500m');
    expect(value('SPM')).toBe('24 spm');
    expect(value('Power')).toBe('187 W');
    expect(value('Heart Rate')).toBe('148 bpm');
    expect(value('Meters')).toBe('1000 m');
    expect(value('Time')).toBe('4:12');
  });

  it('shows a placeholder for a metric that has not arrived', () => {
    setWidth(1280);
    render(<RowHud {...props({ pace: null, spm: null, power: null, heartRate: null })} />);
    const values = screen.getAllByTestId('row-hud-tile').map((t) => t.querySelector('.activity-stat-value')!.textContent);
    expect(values.slice(0, 4)).toEqual(['--:--', '-- spm', '-- W', '-- bpm']);
  });

  it('sets its numbers in tabular figures, so a changing split does not jitter', () => {
    render(<RowHud {...props()} />);
    // jsdom does not cascade stylesheets, so the contract is the class the CSS
    // hangs tabular-nums on; the E2E checks the computed style.
    for (const value of document.querySelectorAll('.activity-stat-value')) {
      expect(value).toHaveClass('row-hud-value');
    }
  });

  it('calls pause, resume, reset and end', () => {
    const p = props();
    const { rerender } = render(<RowHud {...p} />);

    fireEvent.click(screen.getByRole('button', { name: /pause/i }));
    expect(p.onPause).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: /reset/i }));
    expect(p.onReset).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: /end workout/i }));
    expect(p.onEnd).toHaveBeenCalledTimes(1);

    rerender(<RowHud {...p} paused />);
    fireEvent.click(screen.getByRole('button', { name: /resume/i }));
    expect(p.onResume).toHaveBeenCalledTimes(1);
    expect(p.onPause).toHaveBeenCalledTimes(1);
  });

  it('carries the structured workout panel above its tiles', () => {
    render(
      <RowHud {...props()}>
        <section aria-label="Structured workout" />
      </RowHud>,
    );
    const hud = screen.getByRole('group', { name: 'Workout' });
    const panel = within(hud).getByRole('region', { name: 'Structured workout' });
    const firstTile = within(hud).getAllByTestId('row-hud-tile')[0];
    expect(panel.compareDocumentPosition(firstTile) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('toggles fullscreen from its button', () => {
    const p = props();
    render(<RowHud {...p} />);
    fireEvent.click(screen.getByRole('button', { name: 'Enter fullscreen' }));
    expect(p.fullscreen.toggle).toHaveBeenCalledTimes(1);
  });

  it('names the fullscreen button for what it will do', () => {
    render(<RowHud {...props({ fullscreen: { active: true, toggle: vi.fn() } })} />);
    expect(screen.getByRole('button', { name: 'Exit fullscreen' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('toggles fullscreen when F is pressed', () => {
    const p = props();
    render(<RowHud {...p} />);

    fireEvent.keyDown(window, { key: 'f' });
    fireEvent.keyDown(window, { key: 'F' });
    expect(p.fullscreen.toggle).toHaveBeenCalledTimes(2);
  });

  it('leaves F alone while someone is typing, or with a modifier held', () => {
    const p = props();
    render(
      <>
        <input aria-label="notes" />
        <RowHud {...p} />
      </>,
    );

    fireEvent.keyDown(screen.getByLabelText('notes'), { key: 'f' });
    // Ctrl+F is the browser's find, and Cmd+F on a Mac.
    fireEvent.keyDown(window, { key: 'f', ctrlKey: true });
    fireEvent.keyDown(window, { key: 'f', metaKey: true });
    expect(p.fullscreen.toggle).not.toHaveBeenCalled();
  });

  it('stops listening for F once it is gone', () => {
    const p = props();
    const { unmount } = render(<RowHud {...p} />);
    unmount();
    fireEvent.keyDown(window, { key: 'f' });
    expect(p.fullscreen.toggle).not.toHaveBeenCalled();
  });
});
