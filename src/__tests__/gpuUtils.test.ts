import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  isWebGLAvailable,
  resetGpuProbeCacheForTests,
  detectGPUCapabilities,
  hasWebGPUAPI,
  classifyGPUTier,
  describeUnmaskedRenderer,
  recommendPerformanceMode,
} from '../utils/gpuUtils';

describe('gpuUtils', () => {
  // Availability is cached, because each probe costs a WebGL context. Clearing
  // it per test keeps one test from being answered by another's stub.
  beforeEach(() => {
    resetGpuProbeCacheForTests();
  });

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

describe('probe contexts are released (#261)', () => {
  /**
   * A browser keeps only a handful of WebGL contexts alive and evicts the
   * oldest when that limit is passed. The capability probes here each created
   * a context and kept it, so a demo row requested seven and the browser threw
   * away the one the scene was drawing into: measured as 9 `webglcontextlost`
   * events in the first 1.5 s, one restore, and a permanently blank stage
   * behind "The 3D view lost the graphics context — restoring...".
   *
   * glContext.ts already released its probes this way; these did not.
   */
  const withStubbedCanvas = async (run: () => void | Promise<void>) => {
    const released: string[] = [];
    const created: string[] = [];
    const realCreate = document.createElement.bind(document);

    vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
      if (tag !== 'canvas') return realCreate(tag);
      return {
        getContext: (kind: string) => {
          created.push(kind);
          if (kind === 'experimental-webgl') return null;
          return {
            getExtension: (name: string) =>
              name === 'WEBGL_lose_context'
                ? { loseContext: () => released.push(kind) }
                : null,
            getParameter: () => 'stub',
          };
        },
      } as unknown as HTMLCanvasElement;
    }) as typeof document.createElement);

    try {
      await run();
    } finally {
      vi.restoreAllMocks();
    }
    return { created, released };
  };

  it('releases the context isWebGLAvailable opens', async () => {
    const { created, released } = await withStubbedCanvas(() => {
      expect(isWebGLAvailable()).toBe(true);
    });

    expect(created.length).toBeGreaterThan(0);
    expect(released, 'isWebGLAvailable kept its probe context alive').toEqual(
      created.filter((k) => k !== 'experimental-webgl'),
    );
  });

  it('releases every context the capability probe opens', async () => {
    const { created, released } = await withStubbedCanvas(async () => {
      await detectGPUCapabilities();
    });

    expect(created.length).toBeGreaterThan(0);
    expect(released.length, 'the capability probe kept contexts alive').toBe(
      created.filter((k) => k !== 'experimental-webgl').length,
    );
  });
});

describe('WebGL availability is asked once (#context-loss)', () => {
  /**
   * Rower3D asks on every mount, and each ask opens a context. A browser keeps
   * only a handful alive and evicts the oldest at the moment a new one is
   * created - before the probe can hand its own back - and the oldest is the
   * context the scene is drawing the river into. Measured on the demo row: a
   * remount probed at ~4.4s and the scene lost its context at ~6.1s, putting
   * 'The 3D view lost the graphics context - restoring...' over the river.
   *
   * Whether this browser has WebGL cannot change while the page is open.
   */
  beforeEach(() => {
    resetGpuProbeCacheForTests();
  });

  it('opens one context however many times it is asked', () => {
    let contexts = 0;
    const realCreate = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
      if (tag !== 'canvas') return realCreate(tag);
      return {
        getContext: (kind: string) => {
          if (kind !== 'webgl2') return null;
          contexts += 1;
          return { getExtension: () => ({ loseContext: () => {} }) };
        },
      } as unknown as HTMLCanvasElement;
    }) as typeof document.createElement);

    try {
      expect(isWebGLAvailable()).toBe(true);
      expect(isWebGLAvailable()).toBe(true);
      expect(isWebGLAvailable()).toBe(true);
      expect(contexts, 'WebGL availability was probed more than once').toBe(1);
    } finally {
      vi.restoreAllMocks();
    }
  });
});
