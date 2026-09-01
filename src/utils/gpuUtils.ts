/**
 * GPU detection and initialization utilities for WebGPU with WebGL fallback.
 * 
 * This module provides utilities for detecting GPU capabilities and
 * creating the appropriate renderer (WebGPU or WebGL).
 */

/**
 * Check if WebGPU is available in the current browser.
 * WebGPU requires both the navigator.gpu API and a compatible adapter.
 */
export async function isWebGPUAvailable(): Promise<boolean> {
  try {
    if (!navigator.gpu) {
      return false;
    }
    const adapter = await navigator.gpu.requestAdapter();
    return adapter !== null;
  } catch {
    return false;
  }
}

/**
 * Synchronous check for WebGPU API presence (doesn't verify adapter availability).
 * Use isWebGPUAvailable() for a complete check.
 */
export function hasWebGPUAPI(): boolean {
  return typeof navigator !== 'undefined' && 'gpu' in navigator;
}

/**
 * Check if WebGL is available in the current browser.
 */
export function isWebGLAvailable(): boolean {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    return !!gl;
  } catch {
    return false;
  }
}

/**
 * Get the preferred GPU backend based on availability.
 * Returns 'webgpu' if WebGPU is available, 'webgl' if only WebGL is available, or 'none' if neither.
 */
export async function getPreferredGPUBackend(): Promise<'webgpu' | 'webgl' | 'none'> {
  if (await isWebGPUAvailable()) {
    return 'webgpu';
  }
  if (isWebGLAvailable()) {
    return 'webgl';
  }
  return 'none';
}

/**
 * GPU capability information returned by detectGPUCapabilities.
 */
export interface GPUCapabilities {
  /** Whether WebGPU is available */
  webgpu: boolean;
  /** Whether WebGL 2 is available */
  webgl2: boolean;
  /** Whether WebGL 1 is available */
  webgl: boolean;
  /** The recommended backend to use ('none' if no GPU rendering available) */
  recommended: 'webgpu' | 'webgl' | 'none';
}

/**
 * Detect all GPU capabilities asynchronously.
 */
export async function detectGPUCapabilities(): Promise<GPUCapabilities> {
  const webgpu = await isWebGPUAvailable();
  
  let webgl2 = false;
  let webgl = false;
  
  try {
    const canvas = document.createElement('canvas');
    webgl2 = !!canvas.getContext('webgl2');
    webgl = !!canvas.getContext('webgl') || !!canvas.getContext('experimental-webgl');
  } catch {
    // Ignore errors
  }
  
  // Determine recommended backend
  let recommended: 'webgpu' | 'webgl' | 'none' = 'none';
  if (webgpu) {
    recommended = 'webgpu';
  } else if (webgl2 || webgl) {
    recommended = 'webgl';
  }
  
  return {
    webgpu,
    webgl2,
    webgl,
    recommended,
  };
}

/**
 * How much geometry and post-processing a GPU can be trusted with.
 *
 * `integrated` covers the shared-memory parts in laptops and phones; `discrete`
 * is a dedicated card; `unknown` is what a browser that withholds the renderer
 * string leaves us with, and it must not be treated as slow — most desktops
 * land there.
 */
export type GPUTier = 'integrated' | 'discrete' | 'unknown';

const INTEGRATED_RENDERER_PATTERNS = [
  /intel/i,
  /\bhd graphics\b/i,
  /\buhd graphics\b/i,
  /\biris\b/i,
  /apple a\d+ gpu/i,
  /\badreno\b/i,
  /\bmali\b/i,
  /powervr/i,
  /swiftshader/i,
  /llvmpipe/i,
  /software/i,
];

const DISCRETE_RENDERER_PATTERNS = [
  /nvidia/i,
  /geforce/i,
  /\brtx\b/i,
  /\bgtx\b/i,
  /quadro/i,
  /radeon/i,
  /\bamd\b/i,
  /\barc\b/i,
  /apple m\d+ (pro|max|ultra)/i,
];

/**
 * Classify the `UNMASKED_RENDERER_WEBGL` string a WebGL context reports.
 *
 * Discrete patterns are tested first: "Intel Arc" and "AMD Radeon on Intel"
 * style strings name both vendors, and the dedicated part is the one that draws.
 */
export function classifyGPUTier(renderer: string | null | undefined): GPUTier {
  if (!renderer) return 'unknown';
  if (DISCRETE_RENDERER_PATTERNS.some((pattern) => pattern.test(renderer))) {
    return 'discrete';
  }
  if (INTEGRATED_RENDERER_PATTERNS.some((pattern) => pattern.test(renderer))) {
    return 'integrated';
  }
  return 'unknown';
}

/**
 * Read the hardware name a WebGL context will admit to.
 *
 * `WEBGL_debug_renderer_info` is the only place the real part number appears;
 * privacy-hardened browsers withhold the extension, and then the plain
 * `RENDERER` string is all there is. Either can be absent, and absence is not
 * evidence of a slow GPU.
 */
export function describeUnmaskedRenderer(context: unknown): string | null {
  const gl = context as WebGLRenderingContext | null;
  if (!gl || typeof gl.getExtension !== 'function') return null;
  try {
    const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
    const parameter = debugInfo ? debugInfo.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
    const name = gl.getParameter(parameter);
    return typeof name === 'string' ? name : null;
  } catch {
    return null;
  }
}

/** What a renderer tells us about the hardware it ended up on. */
export interface RendererProfile {
  /** `renderer.capabilities.maxTextureSize`, where the backend exposes one. */
  maxTextureSize?: number;
  /** The unmasked renderer string, where the browser discloses one. */
  renderer?: string | null;
  /** Whether the scene is running on a WebGPU backend. */
  webgpu?: boolean;
}

/**
 * Pick a performance mode for the hardware actually running the scene.
 *
 * `low` is for parts that will not hold a frame rate with shadows and
 * post-processing: a small texture budget is the clearest signal, and shared
 * memory the next clearest. `high` is only offered where WebGPU came up, since
 * that is the path with the headroom for larger shadow maps and reflection
 * probes. Everything else gets `auto`, which is also where an undisclosed
 * renderer lands — guessing `low` from silence would downgrade most desktops.
 */
export function recommendPerformanceMode({
  maxTextureSize,
  renderer,
  webgpu = false,
}: RendererProfile): 'low' | 'auto' | 'high' {
  if (Number.isFinite(maxTextureSize) && (maxTextureSize as number) < 4096) return 'low';

  const tier = classifyGPUTier(renderer);
  if (tier === 'integrated') return 'low';
  if (webgpu) return 'high';
  return 'auto';
}
