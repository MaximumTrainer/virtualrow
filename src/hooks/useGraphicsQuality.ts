import { useCallback, useEffect, useState } from 'react';
import type { PerformanceMode } from '../components/rower3d/constants';

/**
 * The rower's graphics-quality choice.
 *
 * `auto` lets the scene pick from what the GPU reports (#224 4G). The other
 * three are the rower overriding that — someone who knows their hardware, or
 * who would rather have frames than shadows, should not have to argue with a
 * heuristic.
 */
export type GraphicsQuality = 'auto' | PerformanceMode;

export const GRAPHICS_QUALITY_STORAGE_KEY = 'virtualrow:graphics-quality';

export const GRAPHICS_QUALITY_OPTIONS: ReadonlyArray<{
  value: GraphicsQuality;
  label: string;
  hint: string;
}> = [
  { value: 'auto', label: 'Auto', hint: 'Match the graphics card' },
  { value: 'low', label: 'Low', hint: 'No shadows or effects' },
  { value: 'high', label: 'High', hint: 'Everything on' },
];

const isQuality = (value: unknown): value is GraphicsQuality =>
  value === 'auto' || value === 'low' || value === 'high';

const readStored = (): GraphicsQuality => {
  try {
    const stored = localStorage.getItem(GRAPHICS_QUALITY_STORAGE_KEY);
    return isQuality(stored) ? stored : 'auto';
  } catch {
    // Private browsing, or storage disabled. The default is no worse for it.
    return 'auto';
  }
};

export interface GraphicsQualityControl {
  quality: GraphicsQuality;
  setQuality: (next: GraphicsQuality) => void;
  /**
   * What to hand the scene. `auto` becomes `undefined` so the scene falls back
   * to its own hardware detection rather than being pinned to a tier.
   */
  performanceMode: PerformanceMode | undefined;
}

/** Remembered across sessions: the rower sets this once, not every row. */
export const useGraphicsQuality = (): GraphicsQualityControl => {
  const [quality, setStored] = useState<GraphicsQuality>(readStored);

  useEffect(() => {
    try {
      localStorage.setItem(GRAPHICS_QUALITY_STORAGE_KEY, quality);
    } catch {
      // Nothing to do; the choice still applies for this session.
    }
  }, [quality]);

  const setQuality = useCallback((next: GraphicsQuality) => {
    if (isQuality(next)) setStored(next);
  }, []);

  return {
    quality,
    setQuality,
    performanceMode: quality === 'auto' ? undefined : quality,
  };
};
