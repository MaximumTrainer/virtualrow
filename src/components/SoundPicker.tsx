import React from 'react';
import './SoundPicker.css';

/**
 * Switching the sound on, and setting how loud it is (#339).
 *
 * Off until asked for. A browser will not start an AudioContext without a
 * gesture, so this switch is not a preference the app can honour quietly at
 * load — it *is* the gesture, which is why there is a switch at all rather
 * than sound that simply plays.
 */

export interface SoundPickerProps {
  enabled: boolean;
  /** 0..1. */
  volume: number;
  onToggle: (enabled: boolean) => void;
  onVolume: (volume: number) => void;
}

const percent = (volume: number) => `${Math.round(volume * 100)}%`;

export const SoundPicker: React.FC<SoundPickerProps> = ({
  enabled,
  volume,
  onToggle,
  onVolume,
}) => (
  <fieldset className="sound-picker">
    <legend className="sound-picker-legend">Sound</legend>

    <label className="sound-picker-switch">
      <input
        type="checkbox"
        role="switch"
        checked={enabled}
        aria-label="Sound"
        onChange={(event) => onToggle(event.target.checked)}
      />
      <span>{enabled ? 'On' : 'Off'}</span>
    </label>

    {/* A volume for sound that is off is a control with nothing to do. */}
    {enabled && (
      <label className="sound-picker-volume">
        <span className="sound-picker-volume-label">Volume</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={volume}
          aria-label="Volume"
          // The slider's position is not a reading; this is what a screen
          // reader says instead of "0.35".
          aria-valuetext={percent(volume)}
          onChange={(event) => onVolume(Number(event.target.value))}
        />
        {/* And the same number on screen, for a rower setting a level over an erg. */}
        <span className="sound-picker-volume-value">{percent(volume)}</span>
      </label>
    )}
  </fieldset>
);

export default SoundPicker;
