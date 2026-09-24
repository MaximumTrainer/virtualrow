import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  FOLIAGE_SWAY_GLSL,
  makeFoliageBillboardMaterial,
  makeSwayFoliageMaterial,
} from '../components/rower3d/foliageMaterial';

/**
 * Issue #333 — the billboard foliage moves in the wind.
 *
 * What three compiles is the material's shader after `onBeforeCompile` has
 * edited it, so that is what is checked: the chunks three ships for a standard
 * material, handed through the hook exactly as the renderer hands them.
 */

type CompiledShader = Parameters<THREE.Material['onBeforeCompile']>[0];

const compile = (material: THREE.Material): CompiledShader => {
  const shader = {
    uniforms: THREE.UniformsUtils.clone(THREE.ShaderLib.standard.uniforms),
    vertexShader: THREE.ShaderLib.standard.vertexShader,
    fragmentShader: THREE.ShaderLib.standard.fragmentShader,
  } as CompiledShader;
  material.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
  return shader;
};

describe('makeFoliageBillboardMaterial', () => {
  const uTime = { value: 0 };
  const map = new THREE.Texture();
  const material = makeFoliageBillboardMaterial({ map, color: '#3a6840' }, uTime);

  it('is a Lambert material cut out by its texture', () => {
    // Lambert, not PBR. A billboard's shading is painted into its texture, so
    // the physical model buys nothing visible - and it is what the forest
    // cost. Measured on the demo row at the low tier (#333, #391): windows
    // p50 frame 345 ms without foliage, 458 ms with standard foliage, 381 ms
    // with Lambert; ubuntu 228 / 288 / 241.
    expect(material).toBeInstanceOf(THREE.MeshLambertMaterial);
    expect(material).not.toBeInstanceOf(THREE.MeshStandardMaterial);
    expect(material.map).toBe(map);
    expect(material.alphaTest).toBeGreaterThanOrEqual(0.5);
    // Front faces only: the geometry is wound both ways, and a double-sided
    // material flips the normal of a face seen from behind (see
    // createFoliageGeometry), which blacked out every tree seen from its back.
    expect(material.side).toBe(THREE.FrontSide);
    // Cut out, not blended: a blended forest has to be sorted back to front,
    // and an instanced one cannot be.
    expect(material.transparent).toBe(false);
    expect(`#${material.color.getHexString()}`).toBe('#3a6840');
  });

  it('sways with uTime, more at the crown than at the root', () => {
    const shader = compile(material);

    expect(shader.vertexShader).toContain('uniform float uTime;');
    expect(shader.vertexShader).toContain(FOLIAGE_SWAY_GLSL);
    expect(FOLIAGE_SWAY_GLSL).toContain('uTime');
    // Scaled by uv.y, which is 0 at the ground: the trunk stays planted.
    expect(FOLIAGE_SWAY_GLSL).toMatch(/\* uv\.y/);
    // Phased by where the tree stands, so a bank does not sway in step.
    expect(FOLIAGE_SWAY_GLSL).toContain('instanceMatrix[3].x');
    // After three has set up `transformed`, and before it is projected.
    const sway = shader.vertexShader.indexOf(FOLIAGE_SWAY_GLSL);
    expect(sway).toBeGreaterThan(shader.vertexShader.indexOf('#include <begin_vertex>'));
    expect(sway).toBeLessThan(shader.vertexShader.indexOf('#include <project_vertex>'));
  });

  it('shares the one clock it was given', () => {
    const shader = compile(material);
    expect(shader.uniforms.uTime).toBe(uTime);
  });

  it('tints each tree a little differently, from where it stands', () => {
    const shader = compile(material);

    expect(shader.vertexShader).toContain('vFoliageTint');
    expect(shader.fragmentShader).toContain('varying float vFoliageTint;');
    expect(shader.fragmentShader.indexOf('diffuseColor.rgb *= vFoliageTint;')).toBeGreaterThan(
      shader.fragmentShader.indexOf('#include <color_fragment>'),
    );
  });

  it('still compiles when a mesh is not instanced', () => {
    // instanceMatrix only exists under USE_INSTANCING; outside it the sway and
    // the tint must fall back rather than reference an undeclared attribute.
    const shader = compile(material);
    expect(shader.vertexShader).toMatch(/#ifdef USE_INSTANCING[\s\S]*instanceMatrix\[3\][\s\S]*#else[\s\S]*#endif/);
  });
});

describe('makeSwayFoliageMaterial', () => {
  it('keeps swaying the cone pines of the flat scene', () => {
    const uTime = { value: 0 };
    const shader = compile(makeSwayFoliageMaterial({ color: '#224422' }, uTime));

    expect(shader.uniforms.uTime).toBe(uTime);
    expect(shader.vertexShader).toContain('swayAmt');
  });
});
