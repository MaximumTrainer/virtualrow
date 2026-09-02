import React from 'react';
import {
  GRAPHICS_QUALITY_OPTIONS,
  type GraphicsQuality,
} from '../hooks/useGraphicsQuality';

export interface GraphicsQualityPickerProps {
  quality: GraphicsQuality;
  onChange: (quality: GraphicsQuality) => void;
}

/**
 * Lets a rower overrule the scene's guess about their graphics card (#224 4G).
 *
 * The scene picks a tier from what the GPU reports, which is right most of the
 * time and wrong for anyone whose browser withholds the renderer string, or who
 * would simply rather have frames than shadows.
 */
export const GraphicsQualityPicker: React.FC<GraphicsQualityPickerProps> = ({
  quality,
  onChange,
}) => (
  <fieldset className="graphics-quality">
    <legend className="graphics-quality-legend">Graphics</legend>
    <div className="graphics-quality-options" role="radiogroup" aria-label="Graphics quality">
      {GRAPHICS_QUALITY_OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={quality === option.value}
          title={option.hint}
          className={`graphics-quality-option${quality === option.value ? ' is-selected' : ''}`}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  </fieldset>
);
