import React from 'react';
import {
  TOP_PALETTE,
  SHORTS_PALETTE,
  SHOES_PALETTE,
  HAIR_PALETTE,
  type PaletteOption,
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

interface SlotRowProps {
  label: string;
  palette: readonly PaletteOption[];
  selected: string;
  onPick: (id: string) => void;
}

const SlotRow: React.FC<SlotRowProps> = ({ label, palette, selected, onPick }) => (
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

/**
 * Lets a rower pick clothing and hair colours (#474 Phase 1).
 *
 * Rendered inside a `<details>` disclosure so the pre-row panel stays compact
 * (D5). Four slots — top, shorts, shoes, hair — are live today; hairstyle and
 * hat are Phase 2 and will land as additional rows once `scripts/build_crew.py`
 * emits the sibling nodes they need (D2).
 */
export const RowerAppearancePicker: React.FC<RowerAppearancePickerProps> = ({
  appearance,
  onChange,
}) => (
  <details className="rower-appearance" data-testid="rower-appearance">
    <summary className="rower-appearance-summary">Rower appearance</summary>
    <div className="rower-appearance-rows">
      <SlotRow
        label="Top"
        palette={TOP_PALETTE}
        selected={appearance.top}
        onPick={(id) => onChange('top', id)}
      />
      <SlotRow
        label="Shorts"
        palette={SHORTS_PALETTE}
        selected={appearance.shorts}
        onPick={(id) => onChange('shorts', id)}
      />
      <SlotRow
        label="Shoes"
        palette={SHOES_PALETTE}
        selected={appearance.shoes}
        onPick={(id) => onChange('shoes', id)}
      />
      <SlotRow
        label="Hair"
        palette={HAIR_PALETTE}
        selected={appearance.hair}
        onPick={(id) => onChange('hair', id)}
      />
    </div>
  </details>
);
