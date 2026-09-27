import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  nightLevelFor,
  sharedNightUniform,
  windowMaterial,
} from '../components/rower3d/windowMaterial';

/**
 * Issue #432 — a window is a physical material whose emission scales with a
 * shared `uNight` uniform, so one write during a Conditions change lights
 * every cloned window across the kit.
 */

describe('windowMaterial (#432)', () => {
  it('is physical, low-roughness, low-metalness, with room for a reflection', () => {
    const mat = windowMaterial(new THREE.Color('#a0c0d0'));
    expect(mat).toBeInstanceOf(THREE.MeshPhysicalMaterial);
    expect(mat.metalness).toBeLessThan(0.2);
    expect(mat.roughness).toBeLessThan(0.1);
    expect(mat.envMapIntensity).toBeGreaterThanOrEqual(1);
  });

  it('carries a warm emissive colour for its interior light', () => {
    const mat = windowMaterial(new THREE.Color('#a0c0d0'));
    // Warm: red is highest. A window lit at dusk reads sodium-lamp, not sky.
    expect(mat.emissive.r).toBeGreaterThan(mat.emissive.b);
  });

  it('installs a uNight uniform through onBeforeCompile', () => {
    const mat = windowMaterial(new THREE.Color('#a0c0d0'));
    // Fake shader that captures what onBeforeCompile does to it.
    const shader = {
      uniforms: {} as Record<string, { value: number }>,
      fragmentShader:
        'placeholder\n#include <common>\nplaceholder\n#include <emissivemap_fragment>\nend',
      vertexShader: '',
    };
    mat.onBeforeCompile!(shader as unknown as THREE.WebGLProgramParametersWithUniforms, {} as THREE.WebGLRenderer);

    expect(shader.uniforms.uNight).toBe(sharedNightUniform);
    expect(shader.fragmentShader).toContain('uniform float uNight');
    expect(shader.fragmentShader).toContain('totalEmissiveRadiance *= uNight');
  });

  it('names its custom program cache key so a swap does not miss', () => {
    const mat = windowMaterial(new THREE.Color('#a0c0d0'));
    expect(mat.customProgramCacheKey!()).toBe('virtualrow-window');
  });
});

describe('nightLevelFor (#432)', () => {
  it('is 0 at midday, 1 at dusk', () => {
    expect(nightLevelFor('midday')).toBe(0);
    expect(nightLevelFor('dusk')).toBe(1);
  });

  it('is 0 under overcast — a bright directionless daytime sky', () => {
    expect(nightLevelFor('overcast')).toBe(0);
  });

  it('is interpolated at dawn and golden — a low sun, not full night', () => {
    expect(nightLevelFor('dawn')).toBeGreaterThan(0);
    expect(nightLevelFor('dawn')).toBeLessThan(1);
    expect(nightLevelFor('golden')).toBeGreaterThan(nightLevelFor('dawn'));
    expect(nightLevelFor('golden')).toBeLessThan(1);
  });
});
