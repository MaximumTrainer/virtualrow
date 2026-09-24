import React, { useState } from 'react';
import { formatSplit } from '../utils/formatters';
import { parsePaceInput, DEFAULT_TARGET_PACE } from '../utils/paceInput';
import './GhostPicker.css';

/**
 * What to race, decided before the row starts (#338).
 *
 * The choice belongs on the route panel rather than mid-row: a rower with a
 * handle in each hand cannot set a target pace, and a ghost that appeared after
 * the start would be racing from behind through no fault of anyone's.
 */

export type GhostChoice =
  | { kind: 'none' }
  | { kind: 'best' }
  | { kind: 'pace'; paceSPer500: number };

export interface GhostPickerProps {
  value: GhostChoice;
  onChange: (choice: GhostChoice) => void;
  /** Whether this browser kept a row on this route that can be raced. */
  hasBest: boolean;
  /** That row's average split, for the label. */
  bestPace: number | null;
}

export const GhostPicker: React.FC<GhostPickerProps> = ({
  value,
  onChange,
  hasBest,
  bestPace,
}) => {
  // What the rower has typed, which is not the same as the pace being raced:
  // the field holds `2:` for a keystroke, and the boat does not.
  const [paceText, setPaceText] = useState(() =>
    formatSplit(value.kind === 'pace' ? value.paceSPer500 : DEFAULT_TARGET_PACE),
  );

  const option = (kind: GhostChoice['kind']) => ({
    type: 'radio' as const,
    name: 'ghost',
    checked: value.kind === kind,
    onChange: () =>
      onChange(
        kind === 'pace'
          ? { kind: 'pace', paceSPer500: parsePaceInput(paceText) ?? DEFAULT_TARGET_PACE }
          : { kind },
      ),
  });

  return (
    <fieldset className="ghost-picker">
      <legend className="ghost-picker-legend">Row against</legend>

      <label className="ghost-picker-option">
        <input {...option('none')} />
        <span>Row alone</span>
      </label>

      <label className="ghost-picker-option">
        <input {...option('best')} disabled={!hasBest} />
        <span>
          Race my best
          {hasBest && bestPace !== null && (
            <span className="ghost-picker-detail"> ({formatSplit(bestPace)}/500m)</span>
          )}
        </span>
      </label>
      {/*
        Disabled with the reason beside it rather than hidden: an option that
        vanishes looks like a feature that is not there, and the rower has done
        nothing wrong - they have simply not rowed here before.
      */}
      {!hasBest && (
        <p className="ghost-picker-hint">
          Your first row on this route — there is nothing to race yet.
        </p>
      )}

      <label className="ghost-picker-option">
        <input {...option('pace')} />
        <span>Pace boat</span>
      </label>

      {value.kind === 'pace' && (
        <label className="ghost-picker-pace">
          <span>Target pace</span>
          <input
            type="text"
            inputMode="numeric"
            className="ghost-picker-pace-field"
            value={paceText}
            placeholder="2:00"
            onChange={(event) => {
              setPaceText(event.target.value);
              const parsed = parsePaceInput(event.target.value);
              if (parsed !== null) onChange({ kind: 'pace', paceSPer500: parsed });
            }}
          />
          <span className="ghost-picker-detail">/500m</span>
        </label>
      )}
    </fieldset>
  );
};

export default GhostPicker;
