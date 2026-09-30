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
 * Since #443 this only renders for guests, demo rows and signed-in athletes
 * whose intervals.icu profile has no `sex` field — an athlete whose profile
 * carries a `sex` reads the rower from that profile alone and gets a short
 * hint pointing at their intervals.icu settings instead. The picker itself is
 * otherwise unchanged and still writes `virtualrow:crew` for the guest case.
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
