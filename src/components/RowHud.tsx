import React, { useEffect, useState } from 'react';
import { metricTiles, HUD_METRIC_LABEL, type HudMetric } from './rowHudPlan';
import { formatSplit, formatTime } from '../utils/formatters';
import { formatGap } from './rower3d/ghost';
import type { FullscreenControl } from '../hooks/useFullscreen';
import './RowHud.css';

/**
 * The numbers, on the stage (#335).
 *
 * They used to live in a panel under the canvas. On a phone or a tablet propped
 * against an erg that panel is below the fold, so the split a rower is rowing
 * to was the one thing on the screen they could not see - and the 3D view they
 * could see was a card with page chrome around it.
 *
 * Everything here sits over the stage: the strip along the bottom, the controls
 * under it, and the fullscreen button in the corner. Which tiles appear is
 * `metricTiles`, because it is a judgement about legibility rather than a list.
 */

export interface RowHudProps {
  /** Seconds per 500 m, or null before the first stroke. */
  paceSecondsPer500: number | null;
  strokeRate: number | null;
  power: number | null;
  heartRate: number | null;
  distanceMeters: number;
  elapsedMs: number;
  paused: boolean;
  onPause: () => void;
  onResume: () => void;
  onReset: () => void;
  onEnd: () => void;
  fullscreen: FullscreenControl;
  /**
   * The boat being chased (#338), or nothing when rowing alone. `gapMeters`
   * is null until the row starts, when two boats on the line have no gap
   * between them worth reading.
   */
  ghost?: { gapMeters: number | null; label: string } | null;
}

/**
 * How wide the window is, kept current.
 *
 * `metricTiles` is a pure function of the width, so something has to tell it
 * when the width changes - a phone turning landscape is the case that matters,
 * and it crosses the six-tile threshold in one event.
 */
const useViewportWidth = (): number => {
  const [width, setWidth] = useState(() =>
    typeof window === 'undefined' ? 1280 : window.innerWidth,
  );

  useEffect(() => {
    const measure = () => setWidth(window.innerWidth);
    window.addEventListener('resize', measure);
    window.addEventListener('orientationchange', measure);
    // Once on mount as well: the first render may have run before the browser
    // settled on a width, and a rower who never resizes would keep that guess.
    measure();
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('orientationchange', measure);
    };
  }, []);

  return width;
};

/**
 * `F` for fullscreen, alongside the `V` the camera rig already answers to
 * (#328).
 *
 * Ignored while the rower is typing, because the row screen is not the only
 * thing on the page: the debug panel and the workout builder both have fields,
 * and a shortcut that fires inside them types nothing and does something
 * startling instead.
 */
const useFullscreenShortcut = (toggle: () => void): void => {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'f' && event.key !== 'F') return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
      event.preventDefault();
      toggle();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggle]);
};

const valueFor = (
  metric: HudMetric,
  props: Pick<
    RowHudProps,
    'paceSecondsPer500' | 'strokeRate' | 'power' | 'heartRate' | 'distanceMeters' | 'elapsedMs'
  >,
): string => {
  // The number, and only the number. Its unit is in the label above it
  // (#344): at 32px `187 W` does not fit a tile on a 320px phone, and a
  // truncated reading is worse than a small one.
  switch (metric) {
    case 'split':
      return formatSplit(props.paceSecondsPer500);
    case 'spm':
      return `${props.strokeRate ?? '--'}`;
    case 'power':
      return `${props.power ?? '--'}`;
    case 'hr':
      return `${props.heartRate ?? '--'}`;
    case 'distance':
      return `${Math.round(props.distanceMeters)}`;
    case 'time':
      return formatTime(props.elapsedMs);
  }
};

export const RowHud: React.FC<RowHudProps> = (props) => {
  const { paused, onPause, onResume, onReset, onEnd, fullscreen } = props;
  const tiles = metricTiles(useViewportWidth());
  useFullscreenShortcut(fullscreen.toggle);

  return (
    <div className="row-hud">
      <div className="row-hud-actions">
        <button
          type="button"
          className="btn-hud-action btn-hud-fullscreen"
          onClick={fullscreen.toggle}
          aria-pressed={fullscreen.active}
          title="Fullscreen (F)"
          aria-label={fullscreen.active ? 'Leave fullscreen' : 'Fill the screen with the row'}
        >
          <span aria-hidden="true">{fullscreen.active ? '⤡' : '⛶'}</span>
        </button>
      </div>

      {props.ghost && props.ghost.gapMeters !== null && (
        <p
          className="row-hud-gap"
          // The lead is in the sign as well as in the colour (#344): a rower
          // who cannot tell the greens from the reds reads the same thing.
          data-lead={
            Math.abs(props.ghost.gapMeters) < 1
              ? 'level'
              : props.ghost.gapMeters > 0
                ? 'ahead'
                : 'behind'
          }
        >
          <span className="row-hud-gap-value">{formatGap(props.ghost.gapMeters)}</span>{' '}
          <span className="row-hud-gap-label">on {props.ghost.label}</span>
        </p>
      )}

      <div className="row-hud-strip">
        {/* The class names are the ones the panel below the stage used. The
            tiles moved and were restyled; they are still the same six numbers,
            and everything that reads them - a rower's eye included - should not
            have to be retaught where they are. */}
        <div className="activity-stats-grid">
          {tiles.map((metric) => (
            <div className="activity-stat-card" key={metric}>
              <span className="activity-stat-label">{HUD_METRIC_LABEL[metric]}</span>
              <span className="activity-stat-value">{valueFor(metric, props)}</span>
            </div>
          ))}
        </div>

        <div className="activity-controls">
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
    </div>
  );
};
