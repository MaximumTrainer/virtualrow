/**
 * Shadow configuration per performance tier (#559 D1-a / D3-a).
 *
 * Cascade count matches #495 Phase 1 (PR #500); the atlas sizes match the
 * three-side `CascadedShadowsConfig.mapSize` and stay inside the 2048 ×
 * 2048 limit SwiftShader supports in CI.
 */

export type PerformanceTier =
  | 'basic'
  | 'low'
  | 'medium'
  | 'high'
  | 'extra-high';

export interface ShadowTierConfig {
  cascades: number;
  atlasSize: number;
}

const TIERS: Record<PerformanceTier, ShadowTierConfig> = {
  basic: { cascades: 2, atlasSize: 512 },
  low: { cascades: 2, atlasSize: 1024 },
  medium: { cascades: 3, atlasSize: 1024 },
  high: { cascades: 3, atlasSize: 2048 },
  'extra-high': { cascades: 4, atlasSize: 2048 },
};

export const DEFAULT_TIER: PerformanceTier = 'medium';

export const shadowConfigFor = (tier: string | undefined): ShadowTierConfig => {
  if (tier && tier in TIERS) {
    return TIERS[tier as PerformanceTier];
  }
  return TIERS[DEFAULT_TIER];
};

export const KNOWN_TIERS: readonly PerformanceTier[] = [
  'basic',
  'low',
  'medium',
  'high',
  'extra-high',
];
