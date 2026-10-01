import { useCallback, useEffect, useState } from 'react';
import type { PerformanceMode } from '../components/rower3d/constants';

/**
 * The rower's graphics-quality choice.
 *
 * Six choices after #455: `auto` lets the probe pick from what the GPU
 * reports (#224 4G, now via `useDevicePerformance`), and the five tiers
 * are the rower overriding that pick.
 */
export type GraphicsQuality = 'auto' | PerformanceMode;

export const GRAPHICS_QUALITY_STORAGE_KEY = 'virtualrow:graphics-quality';

export const GRAPHICS_QUALITY_OPTIONS: ReadonlyArray<{
  value: GraphicsQuality;
  label: string;
  hint: string;
}> = [
  { value: 'auto', label: 'Auto', hint: 'Match the graphics card' },
  { value: 'basic', label: 'Basic', hint: 'No shadows or effects' },
  { value: 'low', label: 'Low', hint: 'Shadows on, no post-processing' },
  { value: 'medium', label: 'Medium', hint: 'Shadows, normal maps and colour grade' },
  { value: 'high', label: 'High', hint: 'SSAO and depth of field' },
  { value: 'extra-high', label: 'Extra High', hint: 'Everything on' },
];

const isQuality = (value: unknown): value is GraphicsQuality =>
  value === 'auto' ||
  value === 'basic' ||
  value === 'low' ||
  value === 'medium' ||
  value === 'high' ||
  value === 'extra-high';

/**
 * #455 D3 / FR5 storage migration.
 *
 * Reads `virtualrow:graphics-quality` and maps legacy three-tier values to
 * the five-tier scheme:
 *   - `'low'`  → `'basic'`     (today's lowest tier keeps its pixels)
 *   - `'high'` → `'extra-high'` (today's top tier keeps its pixels)
 *   - `'auto'` → `'auto'`      (still the picker's "let the app decide")
 *   - new five-tier values pass through
 *   - anything else → `'auto'`
 *
 * The caller rewrites the key with the migrated value so a second read is
 * free. Same key, bumped shape.
 */
const migrateLegacyQuality = (stored: unknown): GraphicsQuality => {
  if (stored === 'low') return 'basic';
  if (stored === 'high') return 'extra-high';
  if (isQuality(stored)) return stored;
  return 'auto';
};

const readStored = (): GraphicsQuality => {
  try {
    const stored = localStorage.getItem(GRAPHICS_QUALITY_STORAGE_KEY);
    return migrateLegacyQuality(stored);
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

export { migrateLegacyQuality };
