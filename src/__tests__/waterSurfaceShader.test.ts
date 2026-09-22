import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  WATER_FRESNEL_F0,
  WATER_FRESNEL_STRENGTH,
  attachGerstnerShader,
  attachWaterSurface,
} from '../components/rower3d/helpers';
import {
  SKY_ENVIRONMENT_SCALE,
  buildSkyEnvironment,
  buildSkyScene,
} from '../components/rower3d/skyEnvironment';
import { getThemeConfig } from '../components/rower3d/themeConfig';

/**
 * Issue #324 — the water's fragment half.
 *
 * The channel had one normal map slot and no fresnel, so it was the same
 * brightness looking down at it as looking along it. Water is the opposite of
 * that: dark underfoot, a mirror at the far bank. This is the injection that
 * does both, and the thing most worth testing about it is that it *composes* —
 * `attachGerstnerShader` owns the same `onBeforeCompile`, and a hook that
 * replaced it would silently delete the waves.
 */

const ripple2 = () => ({
  uRipple2Offset: { value: new THREE.Vector2() },
  uRipple2Scale: { value: 1.7 },
});

/** Run a material's compile hook over a stand-in shader and hand back both stages. */
const compiled = (prepare: (material: THREE.MeshStandardMaterial) => void) => {
  const material = new THREE.MeshStandardMaterial();
  prepare(material);

  const shader = {
    uniforms: {} as Record<string, unknown>,
    vertexShader: '#include <beginnormal_vertex>\n#include <begin_vertex>\n',
    fragmentShader: 'void main() {\n#include <normal_fragment_maps>\n}\n',
  };

  expect(typeof material.onBeforeCompile, 'no shader hook was installed').toBe('function');
  material.onBeforeCompile!(
    shader as unknown as THREE.WebGLProgramParametersWithUniforms,
    {} as THREE.WebGLRenderer,
  );
  return shader;
};

describe('attachWaterSurface', () => {
  it('blends towards the reflection at a grazing angle', () => {
    const { fragmentShader } = compiled((m) => attachWaterSurface(m, ripple2()));

    expect(fragmentShader).toContain('wFresnel');
    expect(fragmentShader, "Schlick's F0 for water is not in the shader").toContain(
      WATER_FRESNEL_F0.toFixed(4),
    );
    expect(fragmentShader).toContain(WATER_FRESNEL_STRENGTH.toFixed(4));
  });

  it('samples the ripple tile a second time, at its own offset and scale', () => {
    const { fragmentShader } = compiled((m) => attachWaterSurface(m, ripple2()));

    expect(fragmentShader, 'there is only one ripple layer').toContain('uRipple2Offset');
    expect(fragmentShader).toContain('uRipple2Scale');
    expect(fragmentShader, 'the second layer is declared but never sampled').toContain(
      'texture2D(',
    );
  });

  it('declares its uniforms before using them', () => {
    const { fragmentShader } = compiled((m) => attachWaterSurface(m, ripple2()));

    const declaration = fragmentShader.indexOf('uniform vec2 uRipple2Offset;');
    const use = fragmentShader.indexOf('uRipple2Offset', declaration + 1);

    expect(declaration, 'the uniform is used but never declared').toBeGreaterThanOrEqual(0);
    expect(use, 'the uniform is declared but never used').toBeGreaterThan(declaration);
  });

  it('hands three the same uniform objects it was given, so a frame can write them', () => {
    const uniforms = ripple2();
    const { uniforms: bound } = compiled((m) => attachWaterSurface(m, uniforms));

    expect(bound.uRipple2Offset).toBe(uniforms.uRipple2Offset);
    expect(bound.uRipple2Scale).toBe(uniforms.uRipple2Scale);
  });

  it('keeps the chunk it replaced, so the rest of three still compiles', () => {
    const { fragmentShader } = compiled((m) => attachWaterSurface(m, ripple2()));

    expect(fragmentShader).toContain('#include <normal_fragment_maps>');
  });

  // The reason this test exists. Both halves set `onBeforeCompile` on the same
  // material; whichever ran second used to be the only one that mattered.
  describe('alongside the Gerstner waves', () => {
    it('leaves the vertex displacement in place', () => {
      const { vertexShader } = compiled((m) => {
        attachGerstnerShader(m, { value: 0 }, 'y', 'test-compose');
        attachWaterSurface(m, ripple2());
      });

      expect(vertexShader, 'the waves were overwritten by the surface hook').toContain(
        'gWave(',
      );
      expect(vertexShader).toContain('vec3(-wGrad.x, 1.0, -wGrad.y)');
    });

    it('adds the fresnel to the same material', () => {
      const { fragmentShader } = compiled((m) => {
        attachGerstnerShader(m, { value: 0 }, 'y', 'test-compose');
        attachWaterSurface(m, ripple2());
      });

      expect(fragmentShader).toContain('wFresnel');
    });

    it("keeps the waves' time uniform bound", () => {
      const time = { value: 4 };
      const { uniforms } = compiled((m) => {
        attachGerstnerShader(m, time, 'y', 'test-compose');
        attachWaterSurface(m, ripple2());
      });

      expect(uniforms.uTime, 'the wave clock was dropped').toBe(time);
    });
  });
});

describe('buildSkyEnvironment', () => {
  // A river without a reflection is still a river. A scene that throws on
  // mount because `PMREMGenerator` could not convolve a cube map is not.
  it('returns nothing rather than throwing where there is no GL to convolve with', () => {
    const renderer = {} as THREE.WebGLRenderer;
    const sky = getThemeConfig('willowbrook').sky;

    expect(() => buildSkyEnvironment(renderer, sky)).not.toThrow();
    expect(buildSkyEnvironment(renderer, sky)).toBeNull();
  });

  it('captures a scene holding the sky and nothing else', () => {
    // The fault it replaces: `PMREMEnvironment` calls `fromScene(scene)` on
    // mount, before `Sky` has drawn, so the map it captures is near-black —
    // and the water material's "no environment map to reflect" was describing
    // a state that code had created. This one cannot depend on load order,
    // because the only thing in the scene it captures is the sky it just made.
    const { scene, mesh } = buildSkyScene(getThemeConfig('willowbrook').sky);

    expect(scene.children, 'the captured scene is not just the sky').toHaveLength(1);
    expect(scene.children[0]).toBe(mesh);
  });

  it('lights the sky the way the theme asks', () => {
    const sky = getThemeConfig('willowbrook').sky;
    const { mesh } = buildSkyScene(sky);
    const uniforms = mesh.material.uniforms;

    expect(uniforms.turbidity.value).toBe(sky.turbidity);
    expect(uniforms.rayleigh.value).toBe(sky.rayleigh);
    expect(uniforms.mieCoefficient.value).toBe(sky.mieCoefficient);
    expect(uniforms.mieDirectionalG.value).toBe(sky.mieDirectionalG);
    expect(uniforms.sunPosition.value.toArray()).toEqual(sky.sunPosition);
  });

  it('builds a dome big enough to be a sky rather than a ball over the boat', () => {
    const { mesh } = buildSkyScene(getThemeConfig('willowbrook').sky);
    expect(mesh.scale.x).toBe(SKY_ENVIRONMENT_SCALE);
  });
});
