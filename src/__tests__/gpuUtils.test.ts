import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  isWebGLAvailable,
  hasWebGPUAPI,
  classifyGPUTier,
  describeUnmaskedRenderer,
  recommendPerformanceMode,
} from '../utils/gpuUtils';

describe('gpuUtils', () => {
  describe('isWebGLAvailable', () => {
    let originalCreateElement: typeof document.createElement;
    
    beforeEach(() => {
      originalCreateElement = document.createElement.bind(document);
    });
    
    afterEach(() => {
      document.createElement = originalCreateElement;
    });
    
    it('returns false when canvas context is not available', () => {
      document.createElement = vi.fn().mockReturnValue({
        getContext: vi.fn().mockReturnValue(null),
      });
      expect(isWebGLAvailable()).toBe(false);
    });
    
    it('returns true when webgl2 context is available', () => {
      document.createElement = vi.fn().mockReturnValue({
        getContext: vi.fn().mockImplementation((contextType: string) => {
          if (contextType === 'webgl2') return {};
          return null;
        }),
      });
      expect(isWebGLAvailable()).toBe(true);
    });
    
    it('returns true when webgl context is available (fallback from webgl2)', () => {
      document.createElement = vi.fn().mockReturnValue({
        getContext: vi.fn().mockImplementation((contextType: string) => {
          if (contextType === 'webgl') return {};
          return null;
        }),
      });
      expect(isWebGLAvailable()).toBe(true);
    });
    
    it('returns false when an error is thrown', () => {
      document.createElement = vi.fn().mockImplementation(() => {
        throw new Error('Canvas not supported');
      });
      expect(isWebGLAvailable()).toBe(false);
    });
  });
  
  describe('hasWebGPUAPI', () => {
    it('returns false when navigator.gpu is not available', () => {
      // In JSDOM, navigator.gpu is not available
      expect(hasWebGPUAPI()).toBe(false);
    });
  });
});

describe('classifyGPUTier', () => {
  it('reads the dedicated cards', () => {
    expect(classifyGPUTier('ANGLE (NVIDIA GeForce RTX 4070 Direct3D11 vs_5_0)')).toBe('discrete');
    expect(classifyGPUTier('AMD Radeon Pro 5500M OpenGL Engine')).toBe('discrete');
    expect(classifyGPUTier('Apple M2 Max')).toBe('discrete');
  });

  it('reads the shared-memory parts', () => {
    expect(classifyGPUTier('ANGLE (Intel(R) UHD Graphics 620 Direct3D11 vs_5_0)')).toBe('integrated');
    expect(classifyGPUTier('Apple A15 GPU')).toBe('integrated');
    expect(classifyGPUTier('Mali-G78')).toBe('integrated');
    expect(classifyGPUTier('Google SwiftShader')).toBe('integrated');
  });

  it('lets the dedicated part win when a string names both vendors', () => {
    expect(classifyGPUTier('ANGLE (Intel, AMD Radeon RX 6800 XT, OpenGL)')).toBe('discrete');
    expect(classifyGPUTier('Intel(R) Arc(TM) A770 Graphics')).toBe('discrete');
  });

  it('does not guess when the browser withholds the renderer', () => {
    expect(classifyGPUTier(null)).toBe('unknown');
    expect(classifyGPUTier('')).toBe('unknown');
    expect(classifyGPUTier('WebKit WebGL')).toBe('unknown');
  });
});

describe('recommendPerformanceMode', () => {
  it('drops to low when the texture budget is small', () => {
    expect(recommendPerformanceMode({ maxTextureSize: 2048, renderer: 'NVIDIA GeForce RTX 4090' }))
      .toBe('low');
  });

  it('drops to low on integrated graphics', () => {
    expect(recommendPerformanceMode({ maxTextureSize: 16384, renderer: 'Intel Iris Plus Graphics' }))
      .toBe('low');
  });

  it('offers high only where WebGPU came up', () => {
    const discrete = { maxTextureSize: 16384, renderer: 'NVIDIA GeForce RTX 4070' };
    expect(recommendPerformanceMode({ ...discrete, webgpu: true })).toBe('high');
    expect(recommendPerformanceMode(discrete)).toBe('auto');
  });

  it('keeps an undisclosed renderer on auto rather than assuming the worst', () => {
    expect(recommendPerformanceMode({ maxTextureSize: 8192 })).toBe('auto');
    expect(recommendPerformanceMode({ maxTextureSize: 8192, renderer: null })).toBe('auto');
  });

  it('will not promote integrated graphics even on a WebGPU backend', () => {
    expect(
      recommendPerformanceMode({ maxTextureSize: 8192, renderer: 'Intel UHD Graphics', webgpu: true }),
    ).toBe('low');
  });
});

describe('describeUnmaskedRenderer', () => {
  const contextWith = (overrides: Record<string, unknown>) => ({
    RENDERER: 0x1f01,
    getExtension: () => null,
    getParameter: () => null,
    ...overrides,
  });

  it('prefers the unmasked name the debug extension exposes', () => {
    const context = contextWith({
      getExtension: (name: string) =>
        name === 'WEBGL_debug_renderer_info' ? { UNMASKED_RENDERER_WEBGL: 0x9246 } : null,
      getParameter: (p: number) => (p === 0x9246 ? 'NVIDIA GeForce RTX 4070' : 'WebKit WebGL'),
    });
    expect(describeUnmaskedRenderer(context)).toBe('NVIDIA GeForce RTX 4070');
  });

  it('falls back to the plain renderer string when the extension is withheld', () => {
    const context = contextWith({ getParameter: () => 'WebKit WebGL' });
    expect(describeUnmaskedRenderer(context)).toBe('WebKit WebGL');
  });

  it('reports nothing rather than throwing when there is no context', () => {
    expect(describeUnmaskedRenderer(null)).toBeNull();
    expect(describeUnmaskedRenderer({})).toBeNull();
    expect(
      describeUnmaskedRenderer(
        contextWith({
          getParameter: () => {
            throw new Error('context lost');
          },
        }),
      ),
    ).toBeNull();
  });
});

describe('recommendPerformanceMode with an unknown texture budget', () => {
  it('does not downgrade a backend that exposes no capabilities', () => {
    expect(recommendPerformanceMode({ renderer: 'NVIDIA GeForce RTX 4070', webgpu: true }))
      .toBe('high');
  });
});
