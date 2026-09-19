import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { attachGerstnerShader } from '../components/rower3d/helpers';

/**
 * The wave normal has to point along the axis the wave displaces (#298).
 *
 * The shader supports two geometries: a rotated PlaneGeometry, where height is
 * local Z, and the curved channel, where height is local Y. It built the same
 * Z-up normal for both — `vec3(-wGrad.x, -wGrad.y, 1.0)` — so on the curved
 * river, which is the one a route actually uses, the wave normals pointed
 * downstream instead of up and the water was lit as though its waves lay on
 * their side.
 *
 * Never seen by a spec, because the wave shader is skipped under automation.
 */
const compiledVertexShader = (axis: 'y' | 'z'): string => {
  const material = new THREE.MeshStandardMaterial();
  attachGerstnerShader(material, { value: 0 }, axis, `test-${axis}`);

  const shader = {
    uniforms: {} as Record<string, unknown>,
    vertexShader: '#include <beginnormal_vertex>\n#include <begin_vertex>\n',
    fragmentShader: '',
  };
  // Asserted rather than optional-chained: whether the hook is installed at
  // all used to be its own test in rower3d.helpers.test.ts, which this
  // subsumes - calling it and reading what it produced covers both.
  expect(typeof material.onBeforeCompile, 'no shader hook was installed').toBe('function');
  material.onBeforeCompile!(
    shader as unknown as THREE.WebGLProgramParametersWithUniforms,
    {} as THREE.WebGLRenderer,
  );
  return shader.vertexShader;
};

describe('Gerstner wave normals follow the height axis (#298)', () => {
  it('points the normal up the Y axis on the curved channel', () => {
    const source = compiledVertexShader('y');

    // Height is local Y, so the gradient belongs in X and Z and the 1.0 in Y.
    expect(source).toContain('vec3(-wGrad.x, 1.0, -wGrad.y)');
  });

  it('points the normal up the Z axis on the rotated plane', () => {
    const source = compiledVertexShader('z');

    expect(source).toContain('vec3(-wGrad.x, -wGrad.y, 1.0)');
  });

  it('displaces along the same axis it points the normal', () => {
    // The two have to agree, which is the mistake being fixed: they did not.
    expect(compiledVertexShader('y')).toContain('position.y + wH');
    expect(compiledVertexShader('z')).toContain('position.z + wH');
  });
});
