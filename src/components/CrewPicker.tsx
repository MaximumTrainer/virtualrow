import React from 'react';
import {
  CREW_PREFERENCE_OPTIONS,
  type CrewPreference,
} from '../hooks/useCrewPreference';

export interface CrewPickerProps {
  preference: CrewPreference;
  onChange: (preference: CrewPreference) => void;
}

/**
 * Lets a rower choose who is in the boat (#232).
 *
 * The scene takes the rower's gender from their intervals.icu profile, which
 * works for a signed-in athlete who filled that in. A guest, a demo row, or a
 * profile without the field was given the male model and no say in it.
 */
export const CrewPicker: React.FC<CrewPickerProps> = ({ preference, onChange }) => (
  <fieldset className="graphics-quality">
    <legend className="graphics-quality-legend">Rower</legend>
    <div className="graphics-quality-options" role="radiogroup" aria-label="Rower appearance">
      {CREW_PREFERENCE_OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={preference === option.value}
          title={option.hint}
          className={`graphics-quality-option${preference === option.value ? ' is-selected' : ''}`}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  </fieldset>
);
