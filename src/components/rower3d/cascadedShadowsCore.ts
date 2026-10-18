// ============================================================================
// CASCADED SHADOWS — factory, kept out of the component so react-refresh can
// hot-swap `CascadedShadows.tsx` without this file dragging exports along for
// the ride. The component imports from here; everything is pure (#495).
// ============================================================================

import * as THREE from 'three';
import { CSM } from 'three/examples/jsm/csm/CSM.js';

export interface CascadedShadowsConfig {
  /** Number of cascades (2..4 in practice; a 1 would want the single-map path). */
  cascades: number;
  /** Edge of each cascade's shadow map in texels. */
  shadowMapSize: number;
  /**
   * The sun's direction in world space, pointing *from* the light *toward*
   * the scene. Comes from `sunDirection(sceneConfig.lighting)` in `Rower3D`.
   */
  lightDirection: THREE.Vector3;
  /** Sun colour, matched to the preset so CSM's lights look like the main one. */
  lightColor: THREE.ColorRepresentation;
  /** Sun intensity, matched to the preset. */
  lightIntensity: number;
  /**
   * The maximum range the cascades cover, in metres. Clamped against the main
   * camera's `far` on mount so a far plane change can't leave CSM covering a
   * volume the camera never sees.
   */
  maxFar: number;
}

/**
 * Builds the `CSM` instance for the current render tier and tints its
 * directional lights with the preset's sun colour (CSM's constructor doesn't
 * take a light colour; its own lights default to white, so a preset at dusk
 * would otherwise cast noon-white shadows).
 */
export const createCascadedShadows = (
  camera: THREE.Camera,
  parent: THREE.Object3D,
  config: CascadedShadowsConfig,
): CSM => {
  const csm = new CSM({
    camera,
    parent,
    cascades: config.cascades,
    shadowMapSize: config.shadowMapSize,
    lightDirection: config.lightDirection,
    lightIntensity: config.lightIntensity,
    maxFar: config.maxFar,
    mode: 'practical',
    shadowBias: -0.0005,
  });
  const colour = new THREE.Color(config.lightColor);
  for (const light of csm.lights) light.color.copy(colour);
  return csm;
};
