import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as THREE from 'three';
import {
  seededRandom,
  createBoatNormalMap,
  createWaterNormalMap,
  createCausticsTexture,
  attachGerstnerShader,
} from '../components/rower3d/helpers';

// ---------------------------------------------------------------------------
// Minimal canvas-context stub — enough for the texture-generator functions.
// jsdom does not implement a full 2-D canvas API so we provide the subset
// that helpers.ts actually calls.
// ---------------------------------------------------------------------------
function makeCtxStub() {
  const imageData = { data: new Uint8ClampedArray(128 * 128 * 4) };
  return {
    fillStyle: '',
    strokeStyle: '',
    fillRect: vi.fn(),
    strokeStyle_: '',
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    createImageData: vi.fn(() => imageData),
    putImageData: vi.fn(),
    createRadialGradient: vi.fn(() => ({
      addColorStop: vi.fn(),
    })),
  };
}

describe('seededRandom', () => {
  it('returns a value in [0, 1)', () => {
    for (let i = 0; i < 100; i++) {
      const val = seededRandom(i);
      expect(val).toBeGreaterThanOrEqual(0);
      expect(val).toBeLessThan(1);
    }
  });

  it('is deterministic — same seed always yields same value', () => {
    expect(seededRandom(42)).toBe(seededRandom(42));
    expect(seededRandom(0)).toBe(seededRandom(0));
    expect(seededRandom(9999)).toBe(seededRandom(9999));
  });

  it('produces different values for different seeds', () => {
    const vals = new Set([seededRandom(1), seededRandom(2), seededRandom(3), seededRandom(100)]);
    expect(vals.size).toBe(4);
  });

  it('handles negative seeds', () => {
    const val = seededRandom(-5);
    expect(val).toBeGreaterThanOrEqual(0);
    expect(val).toBeLessThan(1);
  });
});

describe('createBoatNormalMap', () => {
  beforeEach(() => {
    vi.spyOn(document, 'createElement').mockReturnValue({
      width: 0,
      height: 0,
      getContext: vi.fn(() => makeCtxStub()),
    } as unknown as HTMLCanvasElement);
  });

  it('returns a THREE.Texture with RepeatWrapping and correct repeat', () => {
    const tex = createBoatNormalMap();
    expect(tex).toBeInstanceOf(THREE.Texture);
    expect(tex.wrapS).toBe(THREE.RepeatWrapping);
    expect(tex.wrapT).toBe(THREE.RepeatWrapping);
    expect(tex.repeat.x).toBe(4);
    expect(tex.repeat.y).toBe(2);
  });
});

describe('createWaterNormalMap', () => {
  beforeEach(() => {
    vi.spyOn(document, 'createElement').mockReturnValue({
      width: 0,
      height: 0,
      getContext: vi.fn(() => makeCtxStub()),
    } as unknown as HTMLCanvasElement);
  });

  it('returns a THREE.CanvasTexture with RepeatWrapping and correct repeat', () => {
    const tex = createWaterNormalMap(1.0);
    expect(tex).toBeInstanceOf(THREE.Texture);
    expect(tex.wrapS).toBe(THREE.RepeatWrapping);
    expect(tex.wrapT).toBe(THREE.RepeatWrapping);
    expect(tex.repeat.x).toBe(8);
    expect(tex.repeat.y).toBe(8);
  });

  it('accepts different frequency values', () => {
    const tex1 = createWaterNormalMap(0.5);
    const tex2 = createWaterNormalMap(2.0);
    expect(tex1).toBeInstanceOf(THREE.Texture);
    expect(tex2).toBeInstanceOf(THREE.Texture);
  });
});

describe('createCausticsTexture', () => {
  beforeEach(() => {
    vi.spyOn(document, 'createElement').mockReturnValue({
      width: 0,
      height: 0,
      getContext: vi.fn(() => makeCtxStub()),
    } as unknown as HTMLCanvasElement);
  });

  it('returns a THREE.CanvasTexture', () => {
    const tex = createCausticsTexture();
    expect(tex).toBeInstanceOf(THREE.Texture);
  });
});

describe('attachGerstnerShader', () => {
  it('sets onBeforeCompile on the material', () => {
    const mat = new THREE.MeshPhysicalMaterial();
    const timeUniform = { value: 0 };
    attachGerstnerShader(mat, timeUniform, 'z', 'test-key');
    expect(typeof mat.onBeforeCompile).toBe('function');
  });

  it('sets customProgramCacheKey that includes the cache key', () => {
    const mat = new THREE.MeshPhysicalMaterial();
    attachGerstnerShader(mat, { value: 0 }, 'y', 'my-theme');
    expect(mat.customProgramCacheKey()).toContain('my-theme');
  });

  it('injects uTime uniform via onBeforeCompile', () => {
    const mat = new THREE.MeshPhysicalMaterial();
    const timeUniform = { value: 42 };
    attachGerstnerShader(mat, timeUniform, 'z', 'key');

    const shader = {
      uniforms: {} as Record<string, unknown>,
      vertexShader: '#include <beginnormal_vertex>\n#include <begin_vertex>',
    };
    mat.onBeforeCompile(shader as unknown as THREE.WebGLProgramParametersWithUniforms, {} as THREE.WebGLRenderer);
    expect(shader.uniforms.uTime).toBe(timeUniform);
    expect(shader.vertexShader).not.toContain('#include <beginnormal_vertex>');
    expect(shader.vertexShader).not.toContain('#include <begin_vertex>');
  });

  it('handles heightAxis "y" without error', () => {
    const mat = new THREE.MeshPhysicalMaterial();
    expect(() =>
      attachGerstnerShader(mat, { value: 0 }, 'y', 'key-y', 1.5, 2.0)
    ).not.toThrow();
    expect(mat.customProgramCacheKey()).toContain('gerstner-key-y');
  });

  it('uses default waveAmplitude and waveFrequency of 1.0', () => {
    const mat1 = new THREE.MeshPhysicalMaterial();
    const mat2 = new THREE.MeshPhysicalMaterial();
    attachGerstnerShader(mat1, { value: 0 }, 'z', 'k');
    attachGerstnerShader(mat2, { value: 0 }, 'z', 'k', 1.0, 1.0);
    // Both should produce the same shader code — verify by checking cache key
    expect(mat1.customProgramCacheKey()).toBe(mat2.customProgramCacheKey());
  });
});
