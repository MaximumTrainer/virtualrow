import * as THREE from 'three';

// ============================================================================
// FOLIAGE SWAY — shared wind-sway vertex shader helper (#107)
// ============================================================================
export function makeSwayFoliageMaterial(
  params: THREE.MeshPhysicalMaterialParameters,
  uTime: THREE.IUniform<number>,
): THREE.MeshPhysicalMaterial {
  const mat = new THREE.MeshPhysicalMaterial(params);
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uTime;
    shader.vertexShader = 'uniform float uTime;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
float swayAmt = sin(uTime * 1.2 + position.x * 0.5) * 0.04 * max(0.0, position.y / 5.0);
transformed.x += swayAmt;
transformed.z += swayAmt * 0.7;`,
    );
  };
  return mat;
}

// ============================================================================
// BILLBOARD FOLIAGE — crossed quads, cut out by their texture, in the wind (#333)
// ============================================================================

/**
 * The wind, in the tree's own space before its instance transform.
 *
 * Phased by where the tree stands so a bank does not sway in step, and scaled
 * by `uv.y` - zero at the ground, one at the crown - so the trunk stays
 * planted. The amplitude is a fraction of the tree's height, because the
 * instance matrix scales it with everything else: three centimetres of sway a
 * metre of tree, a third of a metre at the top of a twelve-metre oak.
 */
export const FOLIAGE_SWAY_GLSL =
  'float sway = sin(uTime * 1.3 + instanceMatrix[3].x * 0.7 + instanceMatrix[3].z * 0.4) * 0.03 * uv.y;\n' +
  'transformed.x += sway; transformed.z += sway * 0.6;';

/**
 * One tint a tree, from a hash of where it stands, in 0.82-1.18.
 *
 * Every tree of a species otherwise shares one colour exactly, and a bank of
 * identical greens reads as wallpaper. A per-instance colour attribute would
 * have to be compacted alongside the matrices each time the cull runs; hashed
 * from the matrix, the tint travels with it for nothing.
 */
const FOLIAGE_TINT_GLSL =
  'vFoliageTint = 0.82 + 0.36 * fract(sin(dot(instanceMatrix[3].xz, vec2(12.9898, 78.233))) * 43758.5453);';

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
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uTime;
    shader.vertexShader =
      'uniform float uTime;\nvarying float vFoliageTint;\n' +
      shader.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
#ifdef USE_INSTANCING
${FOLIAGE_SWAY_GLSL}
${FOLIAGE_TINT_GLSL}
#else
vFoliageTint = 1.0;
#endif`,
      );
    shader.fragmentShader =
      'varying float vFoliageTint;\n' +
      shader.fragmentShader.replace(
        '#include <color_fragment>',
        `#include <color_fragment>
diffuseColor.rgb *= vFoliageTint;`,
      );
  };
  return material;
}
