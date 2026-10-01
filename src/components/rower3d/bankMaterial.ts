import * as THREE from 'three';
import type { PerformanceMode } from './constants';
import { createDetailTexture } from './detailTexture';
import { bankTriplanarChunks } from './shaderChunks';

/**
 * Bank material with a triplanar grass/earth surface (#430).
 *
 * #353 shipped the foundation — a `createDetailTexture` generator and a
 * `shoreDist` per-vertex attribute on each bank strip — and held back the
 * material because a shader edit carries real driver-compile risk. This is
 * that material: an `onBeforeCompile` chunk that installs the varyings the
 * fragment needs, then samples grass and earth in world space, blends by
 * slope and by distance to the waterline, and breaks up the tile with a
 * macro noise on a 64 m grid.
 *
 * Low tier drops the shader: the plain `map` on the grass albedo carries
 * the bank without a compile step and without a triplanar sample per pixel,
 * so the cheap tier stays cheap.
 */

export interface BankMaterialTheme {
  /** The bank's authored colour, multiplied by the sampled albedo. */
  color: THREE.ColorRepresentation;
  roughness: number;
  metalness: number;
}

/** Whether a material carries the triplanar chunk (a test asks this). */
export const isBankTriplanarMaterial = (
  material: THREE.Material,
): boolean => material.userData?.virtualrowBank === 'triplanar';

export const bankMaterial = (
  theme: BankMaterialTheme,
  tier: PerformanceMode,
): THREE.MeshStandardMaterial => {
  const grass = createDetailTexture('grass');
  // Five tiers (#455 FR3): the two lowest (`basic` and `low`) return the
  // single-albedo material (today's `low` branch); `medium`, `high` and
  // `extra-high` return the triplanar material with normal maps. The split
  // sits here because normal-mapping the triplanar bank is the newer cost
  // added in #437 — a middle tier that cannot afford the extra sample belongs
  // at `low`, not a half-shader.
  if (tier === 'basic' || tier === 'low') {
    // One albedo, no shader. Matches the FR5 spec for the lowest two tiers.
    return new THREE.MeshStandardMaterial({
      color: theme.color,
      map: grass.albedo,
      roughness: theme.roughness,
      metalness: theme.metalness,
      side: THREE.DoubleSide,
    });
  }

  const earth = createDetailTexture('earth');
  const material = new THREE.MeshStandardMaterial({
    color: theme.color,
    // A `map` is required for three's `<map_fragment>` include to enter the
    // shader — otherwise the replacement below never runs and the bank
    // shows the base colour with none of the detail. The value is a
    // placeholder the mapReplacement chunk overwrites in `diffuseColor`.
    map: grass.albedo,
    roughness: theme.roughness,
    metalness: theme.metalness,
    side: THREE.DoubleSide,
  });
  material.userData.virtualrowBank = 'triplanar';

  const chunks = bankTriplanarChunks();
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uGrass = { value: grass.albedo };
    shader.uniforms.uEarth = { value: earth.albedo };
    // #437: sample the normal maps `createDetailTexture` already returns, so
    // grazing light picks up the tufts and clods the height noise carries.
    shader.uniforms.uGrassN = { value: grass.normal };
    shader.uniforms.uEarthN = { value: earth.normal };
    shader.vertexShader = chunks.vertexDeclarations + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>\n${chunks.vertexAssign}`,
    );
    shader.fragmentShader = chunks.fragmentDeclarations + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <map_fragment>',
      `#include <map_fragment>\n${chunks.mapReplacement}`,
    );
    // The bank has no bound `normalMap`, so three's own <normal_fragment_maps>
    // is a no-op here; replace it with a triplanar sample of `uGrassN`/`uEarthN`
    // that perturbs `normal` before lighting.
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <normal_fragment_maps>',
      `#include <normal_fragment_maps>\n${chunks.normalReplacement}`,
    );
  };
  // A distinct cache key so three does not confuse this program with any
  // other MeshStandardMaterial in the scene.
  material.customProgramCacheKey = () => 'virtualrow-bank-triplanar';
  return material;
};
