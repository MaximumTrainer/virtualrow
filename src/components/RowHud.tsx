import { useEffect, useState, type ReactNode } from 'react';
import { formatPace } from '../utils/formatters';
import { isShortcutKey } from '../utils/keyboardShortcut';
import { formatElapsed } from '../utils/formatElapsed';
import { metricTiles, type MetricKey } from './rowHudTiles';

/**
 * The row screen's heads-up display (#335): the metrics a rower reads
 * mid-stroke, on the stage, and the controls for the row.
 *
 * The stat cards used to sit in a panel below the stage, which on a phone
 * propped on the erg was below the fold. Average and maximum heart rate are
 * not read mid-stroke; they are in the summary.
 *
 * The tiles keep the `.activity-stat-*` class names the stat cards had, so a
 * spec that reads a metric by its label reads it the same way here.
 */

export interface RowHudProps {
  /** Seconds per 500m, or null before the first stroke. */
  pace: number | null;
  spm: number | null;
  power: number | null;
  heartRate: number | null;
  /** Metres rowed this session. */
  distance: number;
  elapsedMs: number;
  paused: boolean;
  onPause: () => void;
  onResume: () => void;
  onReset: () => void;
  onEnd: () => void;
  fullscreen: { active: boolean; toggle: () => void | Promise<void> };
  /** The structured workout's panel, which sits above the tiles, centred. */
  children?: ReactNode;
}

/** The shortcut that toggles fullscreen, as in most video players. */
const FULLSCREEN_KEY = 'f';

const orDashes = (value: number | null | undefined) => (value == null ? '--' : String(value));

const useViewportWidth = (): number => {
  const [width, setWidth] = useState(() => window.innerWidth);
  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return width;
};

export function RowHud({
  pace,
  spm,
  power,
  heartRate,
  distance,
  elapsedMs,
  paused,
  onPause,
  onResume,
  onReset,
  onEnd,
  fullscreen,
  children,
}: RowHudProps) {
  const width = useViewportWidth();
  const { toggle: toggleFullscreen } = fullscreen;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isShortcutKey(event, FULLSCREEN_KEY)) void toggleFullscreen();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [toggleFullscreen]);

  const tiles: Record<MetricKey, { label: string; value: string }> = {
    split: { label: 'Split', value: formatPace(pace) },
    spm: { label: 'SPM', value: `${orDashes(spm)} spm` },
    power: { label: 'Power', value: `${orDashes(power)} W` },
    heartRate: { label: 'Heart Rate', value: `${orDashes(heartRate)} bpm` },
    distance: { label: 'Meters', value: `${Math.round(distance)} m` },
    time: { label: 'Time', value: formatElapsed(elapsedMs) },
  };

  return (
    <>
      <button
        type="button"
        className="row-hud-fullscreen"
        aria-pressed={fullscreen.active}
        aria-label={fullscreen.active ? 'Exit fullscreen' : 'Enter fullscreen'}
        title={`${fullscreen.active ? 'Exit' : 'Enter'} fullscreen (F)`}
        onClick={() => void toggleFullscreen()}
      >
        <span aria-hidden="true">{fullscreen.active ? '🗗' : '⛶'}</span>
      </button>

      <div className="row-hud" role="group" aria-label="Workout">
        {children}
        <div className="activity-stats-grid row-hud-tiles" data-tiles={metricTiles(width).length}>
          {metricTiles(width).map((key) => (
            <div key={key} className="activity-stat-card row-hud-tile" data-testid="row-hud-tile">
              <span className="activity-stat-value row-hud-value">{tiles[key].value}</span>
              <span className="activity-stat-label row-hud-label">{tiles[key].label}</span>
            </div>
          ))}
        </div>

        <div className="activity-controls row-hud-controls">
          <button
            className="btn btn-activity-control"
            onClick={paused ? onResume : onPause}
            type="button"
          >
            {paused ? '▶ Resume' : '⏸ Pause'}
          </button>
          <button
            className="btn btn-activity-control btn-activity-control--subtle"
            onClick={onReset}
            type="button"
          >
            ↺ Reset
          </button>
          <button
            className="btn btn-activity-control btn-activity-control--danger btn-end-workout"
            onClick={onEnd}
            type="button"
          >
            ⏹ End Workout
          </button>
        </div>
      </div>
    </>
  );
}
