import * as THREE from 'three';
import { foliageBillboardChunks, foliageSwayChunks } from './shaderChunks';

// ============================================================================
// FOLIAGE SWAY — shared wind-sway vertex shader helper (#107)
// ============================================================================
export function makeSwayFoliageMaterial(
  params: THREE.MeshPhysicalMaterialParameters,
  uTime: THREE.IUniform<number>,
): THREE.MeshPhysicalMaterial {
  const mat = new THREE.MeshPhysicalMaterial(params);
  // `shaders/foliageSway.vert.glsl` (#341).
  const { declarations, sway } = foliageSwayChunks();
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uTime;
    shader.vertexShader = declarations + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>\n${sway}`,
    );
  };
  return mat;
}

// ============================================================================
// BILLBOARD FOLIAGE — crossed quads, cut out by their texture, in the wind (#333)
// ============================================================================

/**
 * The wind, from `shaders/foliageBillboard.glsl` (#341).
 *
 * This and the per-tree tint used to be string constants here. They are GLSL,
 * so they live in a `.glsl` file an editor can colour and `shaders.test.ts`
 * can parse; the reasoning that sat above each is now in that file, beside the
 * lines it explains.
 *
 * Still exported because `foliageMaterial.test.ts` asserts on it.
 */
export const FOLIAGE_SWAY_GLSL = foliageBillboardChunks().sway.trim();

export interface FoliageBillboardParameters {
  /** The leaf mass, from `createFoliageTexture`. */
  map: THREE.Texture;
  /** The species colour, which the grey texture is multiplied by. */
  color: THREE.ColorRepresentation;
}

/**
 * The material a species of billboard tree is drawn with.
 *
 * Alpha-tested rather than blended: blended quads have to be drawn back to
 * front, and the instances of one mesh are drawn in whatever order their
 * matrices happen to be in. Front faces only, because the geometry carries
 * both windings of each quad (`createFoliageGeometry`): as a double-sided
 * material, three flips the normal of a face seen from behind, and these
 * normals point up and out, so a tree seen from its back went black.
 *
 * Lambert rather than standard: the leaf mass, its light side and its dark
 * side are painted into the texture and tinted per tree, so a physically based
 * model adds nothing a rower can see - and on the software rasteriser CI draws
 * with, it was most of what the forest cost (#391).
 */
export function makeFoliageBillboardMaterial(
  { map, color }: FoliageBillboardParameters,
  uTime: THREE.IUniform<number>,
): THREE.MeshLambertMaterial {
  const material = new THREE.MeshLambertMaterial({
    map,
    color,
    alphaTest: 0.5,
    side: THREE.FrontSide,
  });
  const chunks = foliageBillboardChunks();
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uTime;
    shader.vertexShader =
      chunks.vertexDeclarations +
      shader.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
#ifdef USE_INSTANCING
${chunks.sway}${chunks.tint}#else
vFoliageTint = 1.0;
#endif`,
      );
    shader.fragmentShader =
      chunks.fragmentDeclarations +
      shader.fragmentShader.replace(
        '#include <color_fragment>',
        `#include <color_fragment>\n${chunks.tintFragment}`,
      );
  };
  return material;
}
