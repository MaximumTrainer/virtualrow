// ============================================================================
// GRAPHICS-QUALITY PREFERENCE (#455 FR5), ported to runes for #542 P1 and
// split into TWO independent axes for #591-fu P2c:
//
//   `quality`  — shader features / shadows / SSAO / DOF / crew & cloud gates.
//   `distance` — scenery LOD / fog + sprout window / stream look-ahead.
//
// Mirrors Biketerra's "View distance" vs "View quality" split so a rig with
// headroom for geometry but little for post-fx can push distance up without
// paying the SSAO cost, and vice versa. Each axis stores under its own
// localStorage key with the same five-tier + `auto` scheme + the same
// legacy-value migration the single pre-split axis used (#455 D3), so an
// existing user carries their old `virtualrow:graphics-quality` setting
// over as the DEFAULT for both axes on first boot.
// ============================================================================

import type { PerformanceMode } from '../../components/rower3d/constants';

/** The rower's graphics-quality choice: `auto`, or one of the five tiers. */
export type GraphicsQuality = 'auto' | PerformanceMode;

/** Legacy key — read on first boot to seed both axes, written to for back-compat. */
export const GRAPHICS_QUALITY_STORAGE_KEY = 'virtualrow:graphics-quality';
/** #591-fu P2c: new per-axis keys. */
export const GRAPHICS_QUALITY_KEY = 'virtualrow:graphics-quality';
export const GRAPHICS_DISTANCE_KEY = 'virtualrow:graphics-distance';

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

export const isGraphicsQuality = (value: unknown): value is GraphicsQuality =>
  value === 'auto' ||
  value === 'basic' ||
  value === 'low' ||
  value === 'medium' ||
  value === 'high' ||
  value === 'extra-high';

/**
 * #455 D3 / FR5 storage migration.
 *
 * Reads a localStorage value and maps legacy three-tier values to the
 * five-tier scheme:
 *   - `'low'`  → `'basic'`      (today's lowest tier keeps its pixels)
 *   - `'high'` → `'extra-high'` (today's top tier keeps its pixels)
 *   - `'auto'` → `'auto'`       (still the picker's "let the app decide")
 *   - new five-tier values pass through
 *   - anything else → `'auto'`
 */
export const migrateLegacyQuality = (stored: unknown): GraphicsQuality => {
  if (stored === 'low') return 'basic';
  if (stored === 'high') return 'extra-high';
  if (isGraphicsQuality(stored)) return stored;
  return 'auto';
};

const readStored = (key: string): GraphicsQuality => {
  try {
    const stored = localStorage.getItem(key);
    return migrateLegacyQuality(stored);
  } catch {
    // Private browsing, or storage disabled. The default is no worse for it.
    return 'auto';
  }
};

/**
 * Remembered across sessions: the rower sets quality AND distance once, not
 * every row. Each axis defaults to `auto`, which hands the engine `undefined`
 * so it can keep using the device-probed tier. A user who already stored a
 * single `virtualrow:graphics-quality` value seeds BOTH axes with it on
 * first construction so the UX is unchanged until they move either slider.
 */
export class GraphicsQualityStore {
  quality = $state<GraphicsQuality>(readStored(GRAPHICS_QUALITY_KEY));
  distance = $state<GraphicsQuality>(readStored(GRAPHICS_DISTANCE_KEY));

  /**
   * What to hand the engine's TIER (quality axis). `auto` becomes
   * `undefined` so the engine falls back to its own hardware detection
   * rather than being pinned to a tier.
   */
  readonly performanceMode = $derived<PerformanceMode | undefined>(
    this.quality === 'auto' ? undefined : this.quality,
  );

  /**
   * What to hand the engine's DISTANCE tier. Same `auto` → `undefined`
   * convention as `performanceMode`.
   */
  readonly distanceMode = $derived<PerformanceMode | undefined>(
    this.distance === 'auto' ? undefined : this.distance,
  );

  setQuality = (next: GraphicsQuality): void => {
    if (!isGraphicsQuality(next)) return;
    this.quality = next;
    try {
      localStorage.setItem(GRAPHICS_QUALITY_KEY, next);
    } catch {
      // Nothing to do; the choice still applies for this session.
    }
  };

  setDistance = (next: GraphicsQuality): void => {
    if (!isGraphicsQuality(next)) return;
    this.distance = next;
    try {
      localStorage.setItem(GRAPHICS_DISTANCE_KEY, next);
    } catch {
      // Nothing to do; the choice still applies for this session.
    }
  };
}
