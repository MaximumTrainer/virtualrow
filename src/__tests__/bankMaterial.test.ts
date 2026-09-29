import { afterAll, beforeAll, describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { installCanvasMock } from './canvasMock';
import { bankMaterial, isBankTriplanarMaterial } from '../components/rower3d/bankMaterial';
import { resetDetailTextureCacheForTesting } from '../components/rower3d/detailTexture';

let uninstallCanvas: () => void;
beforeAll(() => {
  uninstallCanvas = installCanvasMock();
});
afterAll(() => uninstallCanvas());

const theme = { color: '#7a8a3c', roughness: 0.9, metalness: 0 };

describe('bankMaterial (#430)', () => {
  it('carries the triplanar shader at auto', () => {
    resetDetailTextureCacheForTesting();
    const mat = bankMaterial(theme, 'auto');
    expect(isBankTriplanarMaterial(mat)).toBe(true);
    expect(mat.onBeforeCompile).toBeDefined();
  });

  it('carries the triplanar shader at high', () => {
    resetDetailTextureCacheForTesting();
    expect(isBankTriplanarMaterial(bankMaterial(theme, 'high'))).toBe(true);
  });

  it('drops the triplanar shader at low, no shader edit', () => {
    resetDetailTextureCacheForTesting();
    const mat = bankMaterial(theme, 'low');
    expect(isBankTriplanarMaterial(mat)).toBe(false);
    // A plain onBeforeCompile default on THREE.Material is a no-op function
    // that returns void; identity through cloning is not required here.
    expect(mat.userData?.virtualrowBank).toBeUndefined();
  });

  it('installs uGrass, uEarth and the shore varying at auto', () => {
    resetDetailTextureCacheForTesting();
    const mat = bankMaterial(theme, 'auto');

    const shader = {
      uniforms: {} as Record<string, { value: unknown }>,
      vertexShader:
        'placeholder-vertex\n#include <begin_vertex>\nplaceholder-vertex-end',
      fragmentShader:
        'placeholder-fragment\n#include <map_fragment>\n' +
        '#include <normal_fragment_maps>\nplaceholder-fragment-end',
    };
    mat.onBeforeCompile!(
      shader as unknown as THREE.WebGLProgramParametersWithUniforms,
      {} as THREE.WebGLRenderer,
    );

    expect(shader.uniforms.uGrass).toBeDefined();
    expect(shader.uniforms.uEarth).toBeDefined();
    expect(shader.vertexShader).toContain('attribute float shoreDist');
    expect(shader.vertexShader).toContain('vBankWorldPos');
    expect(shader.fragmentShader).toContain('bankTriplanar');
    expect(shader.fragmentShader).toContain('vBankShoreDist');
    // FR2: the slope blend at smoothstep(0.3, 0.7).
    expect(shader.fragmentShader).toMatch(/smoothstep\(\s*0\.3\s*,\s*0\.7/);
    // FR3: the shore blend at smoothstep(0, 2.5) with a wet-earth 0.65.
    expect(shader.fragmentShader).toMatch(/smoothstep\(\s*0\.0\s*,\s*2\.5/);
    expect(shader.fragmentShader).toContain('0.65');
    // FR4: macro noise at 64 m.
    expect(shader.fragmentShader).toContain('/ 64.0');
  });

  it('installs the normal maps and samples them triplanar at auto (#437)', () => {
    resetDetailTextureCacheForTesting();
    const mat = bankMaterial(theme, 'auto');

    const shader = {
      uniforms: {} as Record<string, { value: unknown }>,
      vertexShader:
        'placeholder-vertex\n#include <begin_vertex>\nplaceholder-vertex-end',
      fragmentShader:
        'placeholder-fragment\n#include <map_fragment>\n' +
        '#include <normal_fragment_maps>\nplaceholder-fragment-end',
    };
    mat.onBeforeCompile!(
      shader as unknown as THREE.WebGLProgramParametersWithUniforms,
      {} as THREE.WebGLRenderer,
    );

    // FR1: the two normal uniforms are installed.
    expect(shader.uniforms.uGrassN).toBeDefined();
    expect(shader.uniforms.uEarthN).toBeDefined();
    // FR2: each is sampled triplanar (same helper as the albedo) and the two
    // are blended by the same slope weight before `<normal_fragment_maps>`.
    expect(shader.fragmentShader).toContain('uGrassN');
    expect(shader.fragmentShader).toContain('uEarthN');
    expect(shader.fragmentShader).toMatch(/bankTriplanar\(\s*uGrassN/);
    expect(shader.fragmentShader).toMatch(/bankTriplanar\(\s*uEarthN/);
  });

  it('leaves the shader alone at high past what auto installs (#437)', () => {
    resetDetailTextureCacheForTesting();
    const mat = bankMaterial(theme, 'high');

    const shader = {
      uniforms: {} as Record<string, { value: unknown }>,
      vertexShader:
        'placeholder-vertex\n#include <begin_vertex>\nplaceholder-vertex-end',
      fragmentShader:
        'placeholder-fragment\n#include <map_fragment>\n' +
        '#include <normal_fragment_maps>\nplaceholder-fragment-end',
    };
    mat.onBeforeCompile!(
      shader as unknown as THREE.WebGLProgramParametersWithUniforms,
      {} as THREE.WebGLRenderer,
    );

    expect(shader.uniforms.uGrassN).toBeDefined();
    expect(shader.uniforms.uEarthN).toBeDefined();
  });

  it('installs no normal maps at low (#437)', () => {
    resetDetailTextureCacheForTesting();
    const mat = bankMaterial(theme, 'low');

    // Low returns a plain MeshStandardMaterial with no shader edit, so nothing
    // installs uGrassN/uEarthN. onBeforeCompile stays the base no-op.
    expect(mat.userData?.virtualrowBank).toBeUndefined();
    expect(mat.normalMap).toBeNull();
  });

  it('names a custom program cache key so a swap does not miss', () => {
    resetDetailTextureCacheForTesting();
    const mat = bankMaterial(theme, 'auto');
    expect(mat.customProgramCacheKey!()).toBe('virtualrow-bank-triplanar');
  });

  it('carries the authored colour as albedo tint', () => {
    resetDetailTextureCacheForTesting();
    const mat = bankMaterial(theme, 'auto');
    expect(mat.color.getHexString()).toBe('7a8a3c');
  });

  it('at low, keeps the grass albedo as `map` and no shader', () => {
    resetDetailTextureCacheForTesting();
    const mat = bankMaterial(theme, 'low');
    expect(mat.map).not.toBeNull();
  });
});
