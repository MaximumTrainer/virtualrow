/**
 * What the browser can draw with, and how hard to work it.
 *
 * This module used to probe for WebGPU as well, label the backend `webgpu`,
 * and hand that label to telemetry and to the performance heuristic - while
 * R3F built a `WebGLRenderer` regardless. Nothing ever rendered through
 * WebGPU, so the label was only ever wrong (#345). Adopting `WebGPURenderer`
 * for real is a separate question; scope B of that issue holds it.
 */

/**
 * Hand a probe context straight back to the browser.
 *
 * A browser keeps only a handful of WebGL contexts alive and evicts the oldest
 * once that limit is passed. The probes below each opened a context and kept
 * it, so a demo row requested seven and the browser discarded the one the
 * scene was drawing into — nine `webglcontextlost` events inside 1.5 s, one
 * restore, and a stage stuck behind "The 3D view lost the graphics context —
 * restoring..." (#261).
 *
 * glContext.ts already did this for its own probes; these did not.
 */
const releaseProbeContext = (context: unknown): void => {
  const gl = context as { getExtension?: (name: string) => { loseContext?: () => void } | null } | null;
  try {
    gl?.getExtension?.('WEBGL_lose_context')?.loseContext?.();
  } catch {
    // Extension unavailable; the context is left to normal collection.
  }
};

/**
 * Cached answer for {@link isWebGLAvailable}.
 *
 * Releasing a probe context was not enough. A browser evicts the oldest
 * context at the moment a new one is *created*, which is before the probe can
 * hand its own back - and the oldest is the one the scene is drawing the river
 * into. Rower3D asks on every mount, so a remount cost the scene its context:
 * measured on the demo row, a probe at ~4.4s and 'The 3D view lost the
 * graphics context - restoring...' over the river at ~6.1s.
 *
 * Whether this browser has WebGL cannot change while the page is open, so the
 * answer is kept and no second context is ever opened for it.
 */
let cachedWebGLAvailable: boolean | undefined;

/** Forget the cached probes. For tests, so one never answers another. */
export function resetGpuProbeCacheForTests(): void {
  cachedWebGLAvailable = undefined;
}

/**
 * Check if WebGL is available in the current browser.
 *
 * Asked once per page; see {@link cachedWebGLAvailable} for why.
 */
export function isWebGLAvailable(): boolean {
  if (cachedWebGLAvailable !== undefined) return cachedWebGLAvailable;
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    // Released immediately: this only answers "is WebGL available", and a
    // context kept for that answer costs the scene its own (#261).
    releaseProbeContext(gl);
    cachedWebGLAvailable = !!gl;
    return cachedWebGLAvailable;
  } catch {
    cachedWebGLAvailable = false;
    return cachedWebGLAvailable;
  }
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
}

/**
 * Pick a performance mode for the hardware actually running the scene.
 *
 * `low` is for parts that will not hold a frame rate with shadows and
 * post-processing: a small texture budget is the clearest signal, and shared
 * memory the next clearest. Everything else gets `auto`, which is also where an
 * undisclosed renderer lands — guessing `low` from silence would downgrade most
 * desktops.
 *
 * Nothing is promoted to `high` automatically. It used to be, for a "WebGPU
 * backend" — which in practice meant a renderer that handed back no WebGL
 * context, so the most expensive tier was awarded to the most broken renderer
 * (#345). A rower who wants everything on chooses High in the graphics panel.
 */
export function recommendPerformanceMode({
  maxTextureSize,
  renderer,
}: RendererProfile): 'low' | 'auto' | 'high' {
  if (Number.isFinite(maxTextureSize) && (maxTextureSize as number) < 4096) return 'low';

  const tier = classifyGPUTier(renderer);
  if (tier === 'integrated') return 'low';
  return 'auto';
}
