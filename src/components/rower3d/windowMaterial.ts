import * as THREE from 'three';
import type { Conditions } from './conditions';

/**
 * A window material whose emission scales with a night-level uniform (#432).
 *
 * At midday a window reads as a mirror of the sky; at dusk it reads as a lit
 * pane. `uNight` is the mix: 0 is a cold reflection, 1 is warm interior
 * light. A shared uniform object lets one write to `.value` update every
 * cloned window across the scenery kit without walking materials by hand.
 *
 * Not triplanar and not palette-keyed: a window is small enough that its own
 * albedo and reflection carry it. What matters is that the light in it goes
 * up with the sky's own hour.
 */

/** The warm inside light behind a lit window. */
const WINDOW_EMISSIVE = new THREE.Color('#ffb870');

/**
 * The one uniform object every window material shares.
 *
 * Mutating `value` propagates because three's `onBeforeCompile` binds the
 * uniform through the same reference on every draw; every window's shader
 * reads the same `uniforms.uNight` map entry.
 */
export const sharedNightUniform: { value: number } = { value: 0 };

/** How lit a window's inside reads at each Conditions preset. */
export const nightLevelFor = (condition: Conditions): number => {
  switch (condition) {
    case 'dusk':
      return 1;
    case 'golden':
      return 0.4;
    case 'dawn':
      return 0.15;
    case 'overcast':
      return 0;
    case 'midday':
      return 0;
  }
};

export const windowMaterial = (color: THREE.Color): THREE.MeshPhysicalMaterial => {
  const material = new THREE.MeshPhysicalMaterial({
    color,
    metalness: 0.1,
    roughness: 0.05,
    transmission: 0,
    envMapIntensity: 1.5,
    emissive: WINDOW_EMISSIVE,
    emissiveIntensity: 0,
  });

  // A `uniform float uNight` scales the total emissive light, so a spec that
  // ramps `sharedNightUniform.value` from 0 to 1 sees the emissive rise in
  // lockstep. `emissiveIntensity` alone would need one write per material on
  // every conditions change; the shared uniform is one write.
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uNight = sharedNightUniform;
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <common>',
      '#include <common>\nuniform float uNight;',
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <emissivemap_fragment>',
      '#include <emissivemap_fragment>\ntotalEmissiveRadiance *= uNight;',
    );
  };
  // Make sure any earlier program cache miss for this material key rebuilds
  // with the new onBeforeCompile.
  material.customProgramCacheKey = () => 'virtualrow-window';

  return material;
};
