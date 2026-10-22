// ============================================================================
// GRAPHICS-QUALITY PREFERENCE (#455 FR5), ported to runes for #542 P1.
//
// A runes port of `src/hooks/useGraphicsQuality.ts`: the rower's choice, kept
// in `localStorage` under the same key with the same legacy migration (#455
// D3), so the storage contract is unchanged. `auto` lets the engine pick from
// what the GPU reports; the five tiers are the rower overriding that pick.
// ============================================================================

import type { PerformanceMode } from '../../components/rower3d/constants';

/** The rower's graphics-quality choice: `auto`, or one of the five tiers. */
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
 *   - `'low'`  → `'basic'`      (today's lowest tier keeps its pixels)
 *   - `'high'` → `'extra-high'` (today's top tier keeps its pixels)
 *   - `'auto'` → `'auto'`       (still the picker's "let the app decide")
 *   - new five-tier values pass through
 *   - anything else → `'auto'`
 */
export const migrateLegacyQuality = (stored: unknown): GraphicsQuality => {
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

/** Remembered across sessions: the rower sets this once, not every row. */
export class GraphicsQualityStore {
  quality = $state<GraphicsQuality>(readStored());

  /**
   * What to hand the engine. `auto` becomes `undefined` so the engine falls
   * back to its own hardware detection rather than being pinned to a tier.
   */
  readonly performanceMode = $derived<PerformanceMode | undefined>(
    this.quality === 'auto' ? undefined : this.quality,
  );

  setQuality = (next: GraphicsQuality): void => {
    if (!isQuality(next)) return;
    this.quality = next;
    try {
      localStorage.setItem(GRAPHICS_QUALITY_STORAGE_KEY, next);
    } catch {
      // Nothing to do; the choice still applies for this session.
    }
  };
}
