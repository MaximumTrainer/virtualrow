/**
 * Shader-grass enable predicate (#496 Phase 2) ported from
 * `src/components/rower3d/canvasSurface.ts` `drawsShaderGrass` /
 * `isShaderGrassEnabled`. Decides whether the bank pass should mount its
 * biome-density grass modulation on a given tier, honouring the global
 * `window.__VIRTUALROW_SHADER_GRASS = false` kill switch.
 *
 * Three-free so the renderer can import it directly, and separated from the
 * React copy so the two engines can't drift. The predicate shape (medium+,
 * default on) matches React's Phase 2 state.
 */
import type { PerformanceMode } from '../../scenery/sceneryPlacement';

/** Which tiers run the biome-density grass contribution at all. */
export const drawsShaderGrass = (mode: PerformanceMode): boolean =>
  mode === 'medium' || mode === 'high' || mode === 'extra-high';

/**
 * Whether this tier actually mounts shader grass right now. True unless the
 * tier predicate rules it out OR the global kill switch has been set to
 * `false`; `undefined` reads as on (Phase 2 flipped the default).
 */
export const isShaderGrassEnabled = (mode: PerformanceMode): boolean => {
  if (!drawsShaderGrass(mode)) return false;
  if (typeof window === 'undefined') return true;
  const g = (window as unknown as { __VIRTUALROW_SHADER_GRASS?: boolean }).__VIRTUALROW_SHADER_GRASS;
  return g !== false;
};

/**
 * The modulation strength for the bank's density chunk at this tier. Zero on
 * the two lowest tiers / when the kill switch is set, so the pass can keep
 * its pipeline but skip the chunk at the shader level; a smaller value on
 * medium than on high so a weaker rig gets a lighter touch of the biome
 * tint, matching the tier scaling React's #496 Phase 2 rolls out through
 * `densityScale`.
 */
export const shaderGrassStrengthFor = (mode: PerformanceMode): number => {
  if (!isShaderGrassEnabled(mode)) return 0;
  switch (mode) {
    case 'medium': return 0.6;
    case 'high': return 0.85;
    case 'extra-high': return 1;
    default: return 0;
  }
};
