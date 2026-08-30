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
