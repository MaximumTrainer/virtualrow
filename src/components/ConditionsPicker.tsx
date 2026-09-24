import React from 'react';
import { CONDITIONS, conditionsLabel, type Conditions } from './rower3d/conditions';
import type { ConditionsChoice } from '../hooks/useConditions';

/**
 * The light a row is rowed in (issue #346).
 *
 * On the route panel beside the graphics tier, because it is the same kind of
 * decision: set once, changing how every row looks, and nothing a rower wants
 * to reach for with a handle in each hand.
 *
 * Buttons with `role="radio"` rather than real radio inputs, matching
 * `GraphicsQualityPicker` — the two sit together and should not be two
 * different kinds of control.
 */

export interface ConditionsPickerProps {
  choice: ConditionsChoice;
  /** What `auto` resolved to, so the panel can say what the clock decided. */
  resolved: Conditions;
  onChange: (choice: ConditionsChoice) => void;
}

export const ConditionsPicker: React.FC<ConditionsPickerProps> = ({
  choice,
  resolved,
  onChange,
}) => (
  <fieldset className="conditions-picker">
    <legend className="conditions-picker-legend">Conditions</legend>
    <div className="conditions-picker-options" role="radiogroup" aria-label="Conditions">
      <button
        type="button"
        role="radio"
        aria-checked={choice === 'auto'}
        title="Light the scene for the time of day it is"
        className={`conditions-picker-option${choice === 'auto' ? ' is-selected' : ''}`}
        onClick={() => onChange('auto')}
      >
        My clock
        {/*
          Most rowers never change this, which makes what it *resolved to* the
          thing worth saying: otherwise the panel reports that the setting is
          automatic and never says what automatic decided.
        */}
        {choice === 'auto' && (
          <span className="conditions-picker-resolved"> ({conditionsLabel(resolved)})</span>
        )}
      </button>

      {CONDITIONS.map((condition) => (
        <button
          key={condition}
          type="button"
          role="radio"
          aria-checked={choice === condition}
          className={`conditions-picker-option${choice === condition ? ' is-selected' : ''}`}
          onClick={() => onChange(condition)}
        >
          {conditionsLabel(condition)}
        </button>
      ))}
    </div>
  </fieldset>
);

export default ConditionsPicker;
