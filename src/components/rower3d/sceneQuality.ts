// ============================================================================
// SCENE QUALITY, DECIDED BEFORE THE CANVAS IS BUILT
//
// `isHighQuality` was `props.performanceMode !== 'low'`, and the default mode
// is `auto` — so a canvas was always built for high quality: shadow maps, MSAA,
// device pixel ratio up to 2, and a request for the discrete adapter. The scene
// inside then refined `auto` against the actual GPU and often chose `low`.
//
// On integrated hardware that combination is the worst of both: the surface
// costs what high quality costs while the content looks like low. A rower on an
// Intel UHD measured 891 ms frames — close enough to Windows' GPU watchdog that
// the driver reset, the context was lost, and the scene lasted about a second
// before going blank again.
//
// The same decision is made here from a probe context, so the canvas and the
// scene agree from the first frame (#232).
// ============================================================================

import { recommendPerformanceMode } from '../../utils/gpuUtils';
import type { PerformanceMode } from './constants';

export interface RenderCapabilities {
  maxTextureSize?: number;
  renderer?: string | null;
}

export interface SceneQualityInput {
  requested: PerformanceMode;
  capabilities: RenderCapabilities | null | undefined;
  /** A mode pinned by a test or by `__VIRTUALROW_PERFORMANCE_MODE` is final. */
  explicit?: boolean;
}

/**
 * The quality the scene will actually run at.
 *
 * Only `auto` is up for negotiation, and only when the probe learned something:
 * no capabilities means no evidence, and guessing a downgrade on no evidence is
 * how a capable machine ends up with a worse scene than it asked for.
 */
export const resolveSceneQuality = ({
  requested,
  capabilities,
  explicit = false,
}: SceneQualityInput): PerformanceMode => {
  if (explicit || requested !== 'auto') return requested;
  if (!capabilities || (capabilities.maxTextureSize === undefined && !capabilities.renderer)) {
    return requested;
  }

  return recommendPerformanceMode({
    maxTextureSize: capabilities.maxTextureSize,
    renderer: capabilities.renderer ?? null,
  });
};
