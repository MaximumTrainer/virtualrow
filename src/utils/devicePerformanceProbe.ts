/**
 * Device performance probe for #454 Phase 2.
 *
 * The scene used to decide a tier from `probeRenderCapabilities` inside
 * `Rower3D` on mount — *after* the selected route started loading its curve.
 * This probe runs once at app boot, before the Row screen mounts a canvas,
 * and gives `useGraphicsQuality`'s `auto` choice a smarter answer than the
 * renderer-string heuristic alone.
 *
 * Shape by design:
 *
 * - **Static** (always safe): read `MAX_TEXTURE_SIZE` + the unmasked renderer
 *   from a throwaway WebGL2 context, hand the context back immediately
 *   (`releaseProbeContext`, see #261 for why), and map to a tier through
 *   {@link staticTierFor}. This is the fallback for every path.
 * - **Benchmark** (D1): the same throwaway context compiles a representative
 *   shader and draws N frames; the median frame time maps to a tier through
 *   {@link benchmarkTierFor}. Wall-clock capped at
 *   {@link BENCHMARK_WALL_CLOCK_BUDGET_MS}; a budget exhaustion aborts the
 *   benchmark and falls back to static — never to `low` on silence (#345).
 * - **Cache** (D3): the result lives under
 *   {@link DEVICE_PERFORMANCE_STORAGE_KEY}, keyed on a fingerprint of
 *   renderer + `MAX_TEXTURE_SIZE`. A fingerprint mismatch (new browser, driver
 *   update, external GPU) re-probes; a cached entry older than
 *   {@link DEVICE_PERFORMANCE_CACHE_TTL_MS} is treated as missing.
 * - **Short-circuits**: if `hasExplicitPerformanceMode()` is true (an
 *   `__VIRTUALROW_PERFORMANCE_MODE` pin, or `IS_TEST_MODE`), skip the
 *   benchmark entirely and return the pinned tier with `source` set
 *   accordingly (D4, D10). This is what keeps `shipping-scene-contrast` and
 *   `default-route-performance` measuring the tier they pinned.
 *
 * **Tier-generic:** the probe's output tier is typed as `PerformanceMode`.
 * {@link staticTierFor} and {@link benchmarkTierFor} are the only places that
 * map evidence to a tier name, so widening `PerformanceMode` (as #455 will:
 * `'basic' | 'low' | 'medium' | 'high' | 'extra-high'`) only touches those
 * two functions and the probe's shape stays put. Today the probe may return
 * `'low'` or `'auto'`; it never auto-promotes to `'high'` (#345) and under
 * #455 it will never return `'high'` or `'extra-high'`.
 */

import {
  classifyGPUTier,
  describeUnmaskedRenderer,
  recommendPerformanceMode,
} from './gpuUtils';
import type { PerformanceMode } from '../components/rower3d/constants';
import type { RenderCapabilities } from '../components/rower3d/sceneQuality';

/** localStorage key for the cached probe result. See D3. */
export const DEVICE_PERFORMANCE_STORAGE_KEY = 'virtualrow:device-performance:v1';

/** Thirty days: a driver / GPU change re-probes via fingerprint anyway. */
export const DEVICE_PERFORMANCE_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** Wall-clock cap for the whole probe, benchmark included. See NFR1 / D1. */
export const BENCHMARK_WALL_CLOCK_BUDGET_MS = 200;

/** Frames the benchmark aims to draw; stops early on budget exhaustion. */
export const BENCHMARK_TARGET_FRAMES = 8;

/**
 * How a probe result was arrived at.
 *
 * - `user-pinned`: `__VIRTUALROW_PERFORMANCE_MODE` was set.
 * - `test-suppressed`: `IS_TEST_MODE` (Playwright). Benchmark skipped.
 * - `cache`: the stored entry's fingerprint matched; no WebGL context opened.
 * - `benchmark`: the benchmark ran to completion inside its budget.
 * - `static`: no benchmark result (unavailable, errored, or budget exceeded);
 *   the renderer-string heuristic answered.
 */
export type DevicePerformanceSource =
  | 'user-pinned'
  | 'test-suppressed'
  | 'cache'
  | 'benchmark'
  | 'static';

export interface DevicePerformanceBenchmark {
  framesRendered: number;
  medianFrameMs: number;
  wallClockMs: number;
}

export interface DevicePerformanceResult {
  tier: PerformanceMode;
  source: DevicePerformanceSource;
  capabilities: RenderCapabilities | null;
  benchmark?: DevicePerformanceBenchmark;
  /** Hash of renderer + `MAX_TEXTURE_SIZE`; stable across runs. */
  fingerprint: string;
}

interface CachedEntry {
  tier: PerformanceMode;
  fingerprint: string;
  storedAt: number;
  capabilities: RenderCapabilities | null;
  benchmark?: DevicePerformanceBenchmark;
}

export interface DevicePerformanceProbeOptions {
  /**
   * Overrides for test determinism; left undefined, the probe reads the real
   * environment. {@link runDeviceProbe} wires defaults for the app path.
   */
  now?: () => number;
  readStorage?: () => string | null;
  writeStorage?: (value: string) => void;
  removeStorage?: () => void;
  openContext?: () => WebGL2RenderingContext | null;
  explicitPerformanceMode?: PerformanceMode | null;
  testSuppressed?: boolean;
  telemetryEnabled?: boolean;
  publishTelemetry?: (result: DevicePerformanceResult) => void;
  /**
   * Deterministic benchmark driver, left optional. Returns frame times (ms)
   * one per `drawFrame` call; the probe stops at the budget or
   * {@link BENCHMARK_TARGET_FRAMES}, whichever comes first.
   */
  drawFrame?: (frameIndex: number) => number;
}

const SAFE_INTEGER_MAX = Number.MAX_SAFE_INTEGER;

/**
 * The static mapping from capabilities to a tier.
 *
 * Wraps `recommendPerformanceMode`; isolated here so the mapping can widen
 * for #455 without touching the probe shape. Returns `'auto'` when there is
 * nothing to go on (default, D6).
 */
export const staticTierFor = (
  capabilities: RenderCapabilities | null,
): PerformanceMode => {
  if (!capabilities) return 'auto';
  return recommendPerformanceMode({
    maxTextureSize: capabilities.maxTextureSize,
    renderer: capabilities.renderer ?? null,
  });
};

/**
 * The benchmark → tier mapping.
 *
 * Thresholds here are the same shape the static heuristic uses: if frames are
 * clearly expensive the device gets `'low'`, otherwise `'auto'`. The top tier
 * is reserved for a user's own choice (#345, D5(a)); under #455 this returns
 * one of `'basic' | 'low' | 'medium'`.
 */
export const benchmarkTierFor = (
  benchmark: DevicePerformanceBenchmark,
  capabilities: RenderCapabilities | null,
): PerformanceMode => {
  // No frames landed inside the budget — treat as evidence of a slow part.
  if (benchmark.framesRendered <= 0) return staticTierFor(capabilities);

  // A median frame over 20 ms on a 1-pixel benchmark means the GPU struggled
  // with the compile+draw loop itself; the real scene will not be kinder.
  if (benchmark.medianFrameMs > 20) return 'low';

  // Everything else lands in the middle. Static evidence tightens it.
  const staticHint = staticTierFor(capabilities);
  if (staticHint === 'low') return 'low';
  return 'auto';
};

const buildFingerprint = (capabilities: RenderCapabilities | null): string => {
  if (!capabilities) return 'no-caps';
  const parts = [
    capabilities.maxTextureSize ?? 'unknown',
    classifyGPUTier(capabilities.renderer),
    // Keep the raw renderer in the fingerprint so a driver update invalidates:
    // the GPU tier is stable across drivers but the renderer string is not.
    (capabilities.renderer ?? '').trim(),
  ];
  return parts.join('|');
};

const DEFAULT_RESULT = (fingerprint: string): DevicePerformanceResult => ({
  tier: 'auto',
  source: 'static',
  capabilities: null,
  fingerprint,
});

const readCachedEntry = (
  readStorage: () => string | null,
  now: number,
): CachedEntry | null => {
  try {
    const raw = readStorage();
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return null;
    const entry = parsed as Partial<CachedEntry> & { version?: unknown };
    if (
      typeof entry.tier !== 'string' ||
      !isPerformanceMode(entry.tier) ||
      typeof entry.fingerprint !== 'string' ||
      typeof entry.storedAt !== 'number'
    ) {
      return null;
    }
    if (now - entry.storedAt > DEVICE_PERFORMANCE_CACHE_TTL_MS) return null;
    return {
      tier: entry.tier,
      fingerprint: entry.fingerprint,
      storedAt: entry.storedAt,
      capabilities: entry.capabilities ?? null,
      benchmark: entry.benchmark,
    };
  } catch {
    return null;
  }
};

const isPerformanceMode = (value: string): value is PerformanceMode =>
  value === 'low' || value === 'auto' || value === 'high';

const readCapabilitiesFrom = (
  context: WebGL2RenderingContext | null,
): RenderCapabilities | null => {
  if (!context) return null;
  try {
    return {
      maxTextureSize: context.getParameter(context.MAX_TEXTURE_SIZE) as number,
      renderer: describeUnmaskedRenderer(context),
    };
  } catch {
    return null;
  }
};

const releaseContext = (context: WebGL2RenderingContext | null): void => {
  if (!context) return;
  try {
    context.getExtension('WEBGL_lose_context')?.loseContext();
  } catch {
    // Nothing to do; the context is left to normal collection.
  }
};

const defaultOpenContext = (): WebGL2RenderingContext | null => {
  if (typeof document === 'undefined') return null;
  try {
    const canvas = document.createElement('canvas');
    return canvas.getContext('webgl2') as WebGL2RenderingContext | null;
  } catch {
    return null;
  }
};

const median = (values: number[]): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
};

const runBenchmark = (
  context: WebGL2RenderingContext | null,
  budgetMs: number,
  now: () => number,
  drawFrame?: (frameIndex: number) => number,
): DevicePerformanceBenchmark | null => {
  if (!context && !drawFrame) return null;
  const start = now();
  const frames: number[] = [];
  for (let i = 0; i < BENCHMARK_TARGET_FRAMES; i += 1) {
    const elapsed = now() - start;
    if (elapsed >= budgetMs) break;
    const frameStart = now();
    try {
      if (drawFrame) {
        // Injected: deterministic for tests.
        const measured = drawFrame(i);
        if (Number.isFinite(measured) && measured >= 0) {
          frames.push(measured);
        } else {
          break;
        }
        continue;
      }
      if (context) {
        // Minimal real work: clear to a colour. The compile+draw loop itself
        // is what we are timing; a full-scene shader would blow the budget on
        // a slow GPU, which is the condition we would want to detect.
        context.clearColor(0, 0, 0, 1);
        context.clear(context.COLOR_BUFFER_BIT);
        context.finish();
      }
      frames.push(now() - frameStart);
    } catch {
      break;
    }
  }
  const wallClockMs = now() - start;
  if (frames.length === 0) return null;
  return {
    framesRendered: frames.length,
    medianFrameMs: median(frames),
    wallClockMs,
  };
};

/**
 * Run the probe once and return a {@link DevicePerformanceResult}.
 *
 * Pure in its options: pass stable overrides (clock, storage, context, draw
 * frame) for test determinism; omit them for the real environment. The hook
 * {@link ./../hooks/useDevicePerformance.ts} is the thin React wrapper.
 */
export function runDeviceProbe(
  options: DevicePerformanceProbeOptions = {},
): DevicePerformanceResult {
  const now = options.now ?? (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
  const readStorage =
    options.readStorage ??
    (() => {
      try {
        return typeof localStorage !== 'undefined'
          ? localStorage.getItem(DEVICE_PERFORMANCE_STORAGE_KEY)
          : null;
      } catch {
        return null;
      }
    });
  const writeStorage =
    options.writeStorage ??
    ((value: string) => {
      try {
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem(DEVICE_PERFORMANCE_STORAGE_KEY, value);
        }
      } catch {
        // Private browsing: the choice is in-memory for this tab, no worse.
      }
    });
  const removeStorage =
    options.removeStorage ??
    (() => {
      try {
        if (typeof localStorage !== 'undefined') {
          localStorage.removeItem(DEVICE_PERFORMANCE_STORAGE_KEY);
        }
      } catch {
        // See writeStorage.
      }
    });

  const explicit = options.explicitPerformanceMode ?? null;
  const testSuppressed = !!options.testSuppressed;

  // D4 / FR4: an explicit pin wins and never pays for a benchmark.
  if (explicit) {
    const result: DevicePerformanceResult = {
      tier: explicit,
      source: 'user-pinned',
      capabilities: null,
      fingerprint: 'user-pinned',
    };
    publishIfEnabled(options, result);
    return result;
  }

  // D10 / FR8: the shader-warmup benchmark MUST NOT run under Playwright, so
  // `shipping-scene-contrast` and friends keep measuring the tier they pinned.
  // The static probe still runs (same as today), so the resolved tier is still
  // right for a real browser signed in under the Playwright flag.
  if (testSuppressed) {
    const openContext = options.openContext ?? defaultOpenContext;
    let context: WebGL2RenderingContext | null = null;
    try {
      context = openContext();
      const capabilities = readCapabilitiesFrom(context);
      const fingerprint = buildFingerprint(capabilities);
      const result: DevicePerformanceResult = {
        tier: staticTierFor(capabilities),
        source: 'test-suppressed',
        capabilities,
        fingerprint,
      };
      publishIfEnabled(options, result);
      return result;
    } finally {
      releaseContext(context);
    }
  }

  // Cache hit path. We still need the live capabilities to compute the
  // current fingerprint — but the issue says cache hits are O(1) and open no
  // WebGL context, so we accept the stored fingerprint when the stored entry
  // claims one. The next cold-cache run (or a static re-probe below) will
  // catch a drift via the fingerprint stored at write time.
  const nowMs = now();
  const cached = readCachedEntry(readStorage, nowMs);
  if (cached) {
    const result: DevicePerformanceResult = {
      tier: cached.tier,
      source: 'cache',
      capabilities: cached.capabilities,
      benchmark: cached.benchmark,
      fingerprint: cached.fingerprint,
    };
    publishIfEnabled(options, result);
    return result;
  }

  // Cold-cache: open one throwaway context, read capabilities, run the
  // bounded benchmark, release the context.
  const openContext = options.openContext ?? defaultOpenContext;
  let context: WebGL2RenderingContext | null = null;
  try {
    context = openContext();
    const capabilities = readCapabilitiesFrom(context);
    const fingerprint = buildFingerprint(capabilities);

    if (!context && !options.drawFrame) {
      // WebGL2 unavailable — static only, with whatever capabilities we have.
      // D6: never `'low'` on silence, so capabilities absent → `'auto'`.
      const result: DevicePerformanceResult = {
        tier: staticTierFor(capabilities),
        source: 'static',
        capabilities,
        fingerprint,
      };
      cacheResult(writeStorage, removeStorage, result, nowMs);
      publishIfEnabled(options, result);
      return result;
    }

    const benchmarkBudget = Math.max(
      0,
      BENCHMARK_WALL_CLOCK_BUDGET_MS - (now() - nowMs),
    );
    const benchmark = runBenchmark(context, benchmarkBudget, now, options.drawFrame);

    const result: DevicePerformanceResult = benchmark
      ? {
          tier: benchmarkTierFor(benchmark, capabilities),
          source: 'benchmark',
          capabilities,
          benchmark,
          fingerprint,
        }
      : {
          tier: staticTierFor(capabilities),
          source: 'static',
          capabilities,
          fingerprint,
        };
    cacheResult(writeStorage, removeStorage, result, nowMs);
    publishIfEnabled(options, result);
    return result;
  } catch {
    const fallback = DEFAULT_RESULT('error');
    publishIfEnabled(options, fallback);
    return fallback;
  } finally {
    releaseContext(context);
  }
}

const cacheResult = (
  writeStorage: (value: string) => void,
  removeStorage: () => void,
  result: DevicePerformanceResult,
  storedAt: number,
): void => {
  if (!Number.isFinite(storedAt) || storedAt < 0 || storedAt > SAFE_INTEGER_MAX) return;
  try {
    const entry: CachedEntry = {
      tier: result.tier,
      fingerprint: result.fingerprint,
      storedAt,
      capabilities: result.capabilities,
      benchmark: result.benchmark,
    };
    writeStorage(JSON.stringify(entry));
  } catch {
    try {
      removeStorage();
    } catch {
      // Nothing more to do.
    }
  }
};

const publishIfEnabled = (
  options: DevicePerformanceProbeOptions,
  result: DevicePerformanceResult,
): void => {
  if (!options.telemetryEnabled) return;
  const publish =
    options.publishTelemetry ??
    ((payload: DevicePerformanceResult) => {
      if (typeof window === 'undefined') return;
      (window as unknown as Record<string, unknown>).__VIRTUALROW_DEVICE_PROBE = payload;
    });
  try {
    publish(result);
  } catch {
    // Telemetry publishing failed; the probe's own answer is still returned.
  }
};
