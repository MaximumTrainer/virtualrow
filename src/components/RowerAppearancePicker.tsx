import React from 'react';
import {
  TOP_PALETTE,
  SHORTS_PALETTE,
  SHOES_PALETTE,
  HAIR_PALETTE,
  HAT_PALETTE,
  HAIRSTYLE_OPTIONS,
  HAT_OPTIONS,
  type PaletteOption,
  type HairstyleOption,
  type HatOption,
  type HairstyleId,
  type HatId,
} from './rower3d/rowerAppearance';
import type { RowerAppearancePreference } from '../services/rowerAppearanceService';
import './RowerAppearancePicker.css';

export interface RowerAppearancePickerProps {
  appearance: RowerAppearancePreference;
  onChange: <K extends keyof RowerAppearancePreference>(
    slot: K,
    value: RowerAppearancePreference[K],
  ) => void;
}

interface SwatchRowProps {
  label: string;
  palette: readonly PaletteOption[];
  selected: string;
  onPick: (id: string) => void;
}

const SwatchRow: React.FC<SwatchRowProps> = ({ label, palette, selected, onPick }) => (
  <div className="rower-appearance-row">
    <span className="rower-appearance-label">{label}</span>
    <div
      className="rower-appearance-swatches"
      role="radiogroup"
      aria-label={label}
    >
      {palette.map((option) => (
        <button
          key={option.id}
          type="button"
          role="radio"
          aria-checked={selected === option.id}
          aria-label={option.label}
          title={option.label}
          className={`rower-appearance-swatch${selected === option.id ? ' is-selected' : ''}`}
          style={{ backgroundColor: option.hex }}
          onClick={() => onPick(option.id)}
        />
      ))}
    </div>
  </div>
);

interface TextRowProps<T extends string> {
  label: string;
  options: readonly { readonly id: T; readonly label: string }[];
  selected: T;
  onPick: (id: T) => void;
}

const TextRow = <T extends string>({ label, options, selected, onPick }: TextRowProps<T>) => (
  <div className="rower-appearance-row">
    <span className="rower-appearance-label">{label}</span>
    <div
      className="rower-appearance-chips"
      role="radiogroup"
      aria-label={label}
    >
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          role="radio"
          aria-checked={selected === option.id}
          aria-label={option.label}
          title={option.label}
          className={`rower-appearance-chip${selected === option.id ? ' is-selected' : ''}`}
          onClick={() => onPick(option.id)}
        >
          {option.label}
        </button>
      ))}
    </div>
  </div>
);

/**
 * Lets a rower pick clothing, hair, hairstyle, hat and hat colour (#474).
 *
 * Rendered inside a `<details>` disclosure so the pre-row panel stays compact
 * (D5). The hat-colour row is hidden when the hat slot is 'none', since the
 * colour has nothing to apply to.
 */
export const RowerAppearancePicker: React.FC<RowerAppearancePickerProps> = ({
  appearance,
  onChange,
}) => (
  <details className="rower-appearance" data-testid="rower-appearance">
    <summary className="rower-appearance-summary">Rower appearance</summary>
    <div className="rower-appearance-rows">
      <SwatchRow
        label="Top"
        palette={TOP_PALETTE}
        selected={appearance.top}
        onPick={(id) => onChange('top', id)}
      />
      <SwatchRow
        label="Shorts"
        palette={SHORTS_PALETTE}
        selected={appearance.shorts}
        onPick={(id) => onChange('shorts', id)}
      />
      <SwatchRow
        label="Shoes"
        palette={SHOES_PALETTE}
        selected={appearance.shoes}
        onPick={(id) => onChange('shoes', id)}
      />
      <SwatchRow
        label="Hair"
        palette={HAIR_PALETTE}
        selected={appearance.hair}
        onPick={(id) => onChange('hair', id)}
      />
      <TextRow<HairstyleId>
        label="Hairstyle"
        options={HAIRSTYLE_OPTIONS as readonly HairstyleOption[]}
        selected={appearance.hairstyle}
        onPick={(id) => onChange('hairstyle', id)}
      />
      <TextRow<HatId>
        label="Hat"
        options={HAT_OPTIONS as readonly HatOption[]}
        selected={appearance.hat}
        onPick={(id) => onChange('hat', id)}
      />
      {appearance.hat !== 'none' && (
        <SwatchRow
          label="Hat colour"
          palette={HAT_PALETTE}
          selected={appearance.hatColor}
          onPick={(id) => onChange('hatColor', id)}
        />
      )}
    </div>
  </details>
);
