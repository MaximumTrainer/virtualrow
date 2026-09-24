import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import type { SkyConfig } from './themeConfig';

// ============================================================================
// SOMETHING FOR THE WATER TO REFLECT (#324)
//
// `PMREMEnvironment` builds the scene's environment map with
// `fromScene(scene)` on mount — before `Sky` has rendered a frame, and before
// most of the route exists. What it captures is close to black, which is why
// the channel material carried the comment "with no environment map to
// reflect, metalness renders the surface near-black". That was true, and it
// was true because of this: the comment described a state the code had helped
// create.
//
// A sky is the one thing a river reflects that is always there and never
// moves. Built from a scene containing only the sky, once per theme, it does
// not depend on when it is called or on what else has loaded.
// ============================================================================

/** Scale of the sky dome the environment is captured from. */
export const SKY_ENVIRONMENT_SCALE = 4500;

/**
 * Blur applied while convolving, in radians.
 *
 * Small: water at the roughness `waterMaterialPlan` asks for reads the
 * environment sharply, and pre-blurring it would flatten the horizon the
 * reflection is mostly made of.
 */
export const SKY_ENVIRONMENT_BLUR = 0.04;

/**
 * A scene holding nothing but the sky, lit as the theme asks.
 *
 * Separated from the capture below so the claim that matters can be checked
 * without a GL context: what went wrong before was *what was in the scene* at
 * the moment of capture, not the convolution.
 */
export const buildSkyScene = (
  sky: SkyConfig,
  /** Where the disc sits, derived from the lighting angles (#352). */
  sunPosition: readonly [number, number, number],
): { scene: THREE.Scene; mesh: Sky } => {
  const scene = new THREE.Scene();
  const mesh = new Sky();
  mesh.scale.setScalar(SKY_ENVIRONMENT_SCALE);

  const uniforms = mesh.material.uniforms;
  uniforms.turbidity.value = sky.turbidity;
  uniforms.rayleigh.value = sky.rayleigh;
  uniforms.mieCoefficient.value = sky.mieCoefficient;
  uniforms.mieDirectionalG.value = sky.mieDirectionalG;
  uniforms.sunPosition.value.set(...sunPosition);
  scene.add(mesh);

  return { scene, mesh };
};

/**
 * An environment map of the sky alone.
 *
 * Returns null where the renderer cannot convolve one — a headless or lost
 * context — so the water falls back to its own colour rather than the scene
 * failing to mount. The caller owns disposing the texture.
 */
export const buildSkyEnvironment = (
  renderer: THREE.WebGLRenderer,
  sky: SkyConfig,
  sunPosition: readonly [number, number, number],
): THREE.Texture | null => {
  let mesh: Sky | null = null;
  let generator: THREE.PMREMGenerator | null = null;

  try {
    const built = buildSkyScene(sky, sunPosition);
    mesh = built.mesh;

    generator = new THREE.PMREMGenerator(renderer);
    const target = generator.fromScene(built.scene, SKY_ENVIRONMENT_BLUR);
    return target.texture;
  } catch {
    // A renderer with no GL throws from inside three rather than returning
    // anything, and a river without a reflection is still a river.
    return null;
  } finally {
    generator?.dispose();
    mesh?.material.dispose();
    mesh?.geometry.dispose();
  }
};
