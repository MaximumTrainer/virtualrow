import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  BENCHMARK_WALL_CLOCK_BUDGET_MS,
  DEVICE_PERFORMANCE_CACHE_TTL_MS,
  DEVICE_PERFORMANCE_STORAGE_KEY,
  benchmarkTierFor,
  runDeviceProbe,
  staticTierFor,
  type DevicePerformanceProbeOptions,
} from '../utils/devicePerformanceProbe';

/**
 * #454 Phase 2 — static gates on the device-performance probe.
 *
 * The probe is pure in its options (clock, storage, context, draw frame), so
 * every branch is driven here without opening a real WebGL context: that keeps
 * the test deterministic (no SwiftShader frame-time noise) and keeps #261 (one
 * probe context evicted the scene's own) a non-issue — the production code
 * opens one throwaway context at most, the tests open none.
 */
describe('devicePerformanceProbe (#454 Phase 2)', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  const baseOptions = (
    overrides: Partial<DevicePerformanceProbeOptions> = {},
  ): DevicePerformanceProbeOptions => ({
    now: (() => {
      let t = 0;
      return () => {
        t += 1;
        return t;
      };
    })(),
    readStorage: () => null,
    writeStorage: () => undefined,
    removeStorage: () => undefined,
    openContext: () => null,
    ...overrides,
  });

  it('AC3 (FR4): user-pinned mode short-circuits before any WebGL context opens', () => {
    const openContext = vi.fn(() => null);
    const result = runDeviceProbe(
      baseOptions({ openContext, explicitPerformanceMode: 'high' }),
    );
    expect(result).toMatchObject({
      tier: 'high',
      source: 'user-pinned',
      capabilities: null,
    });
    expect(openContext).not.toHaveBeenCalled();
  });

  it('AC3 (FR8, D10): Playwright suppresses the benchmark AND opens no WebGL context (#261)', () => {
    const openContext = vi.fn(() => null);
    const result = runDeviceProbe(
      baseOptions({ openContext, testSuppressed: true }),
    );
    expect(result.source).toBe('test-suppressed');
    // Under #455 test-suppressed returns `basic` so the Playwright visual
    // baseline matches today's lowest tier (which is now `basic`).
    expect(result.tier).toBe('basic');
    // The gl-context-budget spec ratchets contexts opened before the scene's
    // own; a throwaway probe context would blow the #261 budget from 4 to 5.
    expect(openContext).not.toHaveBeenCalled();
    expect(result.benchmark).toBeUndefined();
    expect(result.capabilities).toBeNull();
  });

  it('AC1 / AC8 (FR7): no WebGL2 → static with capabilities=null and tier=medium', () => {
    const result = runDeviceProbe(baseOptions({ openContext: () => null }));
    expect(result).toMatchObject({
      source: 'static',
      tier: 'medium',
      capabilities: null,
    });
  });

  it('AC1 (FR1): a benchmark with a fast median returns source=benchmark, tier=medium', () => {
    const fakeContext = {
      clearColor: vi.fn(),
      clear: vi.fn(),
      finish: vi.fn(),
      getParameter: () => 16384,
      MAX_TEXTURE_SIZE: 0x0d33,
      COLOR_BUFFER_BIT: 0x4000,
      getExtension: () => null,
    } as unknown as WebGL2RenderingContext;

    let frame = 0;
    const result = runDeviceProbe(
      baseOptions({
        openContext: () => fakeContext,
        drawFrame: () => {
          frame += 1;
          return 2;
        },
      }),
    );
    expect(result.source).toBe('benchmark');
    expect(result.tier).toBe('medium');
    expect(result.benchmark?.framesRendered).toBeGreaterThan(0);
    expect(result.benchmark?.medianFrameMs).toBe(2);
    expect(frame).toBeGreaterThan(0);
  });

  it('AC1 (FR1, D1): a benchmark with slow median returns tier=basic', () => {
    const fakeContext = {
      clearColor: vi.fn(),
      clear: vi.fn(),
      finish: vi.fn(),
      getParameter: () => 16384,
      MAX_TEXTURE_SIZE: 0x0d33,
      COLOR_BUFFER_BIT: 0x4000,
      getExtension: () => null,
    } as unknown as WebGL2RenderingContext;

    const result = runDeviceProbe(
      baseOptions({
        openContext: () => fakeContext,
        drawFrame: () => 42, // Well above the 20 ms threshold.
      }),
    );
    expect(result.source).toBe('benchmark');
    expect(result.tier).toBe('basic');
  });

  it('AC9 (NFR1): the probe aborts the benchmark once the wall-clock budget is exceeded', () => {
    let t = 0;
    const now = () => t;
    const fakeContext = {
      clearColor: vi.fn(),
      clear: vi.fn(),
      finish: vi.fn(),
      getParameter: () => 16384,
      MAX_TEXTURE_SIZE: 0x0d33,
      COLOR_BUFFER_BIT: 0x4000,
      getExtension: () => null,
    } as unknown as WebGL2RenderingContext;

    const result = runDeviceProbe(
      baseOptions({
        now,
        openContext: () => fakeContext,
        drawFrame: () => {
          t += BENCHMARK_WALL_CLOCK_BUDGET_MS + 1;
          return 1;
        },
      }),
    );
    // Exactly one frame runs (second iteration sees budget exhausted) and the
    // median-frame-time path still returns a tier; it is `auto` because the
    // single frame measurement was fast.
    expect(result.benchmark?.framesRendered).toBeLessThanOrEqual(1);
  });

  it('AC2 (FR3): a first probe writes a cache entry under the versioned key', () => {
    const fakeContext = {
      clearColor: vi.fn(),
      clear: vi.fn(),
      finish: vi.fn(),
      getParameter: () => 16384,
      MAX_TEXTURE_SIZE: 0x0d33,
      COLOR_BUFFER_BIT: 0x4000,
      getExtension: () => null,
    } as unknown as WebGL2RenderingContext;

    const result = runDeviceProbe({
      now: (() => {
        let t = 0;
        return () => {
          t += 1;
          return t;
        };
      })(),
      openContext: () => fakeContext,
      drawFrame: () => 3,
    });
    expect(result.source).toBe('benchmark');

    const raw = localStorage.getItem(DEVICE_PERFORMANCE_STORAGE_KEY);
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw as string);
    expect(parsed).toMatchObject({
      tier: result.tier,
      fingerprint: result.fingerprint,
    });
    expect(typeof parsed.storedAt).toBe('number');
  });

  it('AC2 (FR3): a cache hit opens no WebGL context and returns source=cache', () => {
    const now = () => 1_000;
    const stored = JSON.stringify({
      tier: 'basic',
      fingerprint: '16384|integrated|Intel Iris',
      storedAt: now() - 10,
      capabilities: { maxTextureSize: 16384, renderer: 'Intel Iris' },
    });
    const openContext = vi.fn(() => null);

    const result = runDeviceProbe({
      now,
      readStorage: () => stored,
      writeStorage: () => undefined,
      removeStorage: () => undefined,
      openContext,
    });

    expect(result.source).toBe('cache');
    expect(result.tier).toBe('basic');
    expect(openContext).not.toHaveBeenCalled();
  });

  it('AC2 (FR3): an expired cache entry is ignored and the probe re-runs', () => {
    const now = () => DEVICE_PERFORMANCE_CACHE_TTL_MS + 10_000;
    const stored = JSON.stringify({
      tier: 'basic',
      fingerprint: 'old',
      storedAt: 0,
      capabilities: null,
    });
    const openContext = vi.fn(() => null);

    const result = runDeviceProbe({
      now,
      readStorage: () => stored,
      writeStorage: () => undefined,
      removeStorage: () => undefined,
      openContext,
    });

    expect(result.source).toBe('static');
    expect(openContext).toHaveBeenCalledTimes(1);
  });

  it('AC2 (FR3): malformed JSON in the cache key is tolerated and re-probed', () => {
    const result = runDeviceProbe({
      now: () => 1_000,
      readStorage: () => '{"not":"a probe entry"',
      writeStorage: () => undefined,
      removeStorage: () => undefined,
      openContext: () => null,
    });
    expect(result.source).toBe('static');
    expect(result.tier).toBe('medium');
  });

  it('AC11 (FR9): publishes to window.__VIRTUALROW_DEVICE_PROBE when telemetry is on', () => {
    const published: unknown[] = [];
    const result = runDeviceProbe({
      now: () => 1,
      readStorage: () => null,
      writeStorage: () => undefined,
      removeStorage: () => undefined,
      openContext: () => null,
      telemetryEnabled: true,
      publishTelemetry: (payload) => published.push(payload),
    });
    expect(published).toEqual([result]);
  });

  it('AC11 (FR9): publishes nothing when telemetry is off', () => {
    const published: unknown[] = [];
    runDeviceProbe({
      now: () => 1,
      readStorage: () => null,
      writeStorage: () => undefined,
      removeStorage: () => undefined,
      openContext: () => null,
      telemetryEnabled: false,
      publishTelemetry: (payload) => published.push(payload),
    });
    expect(published).toHaveLength(0);
  });

  describe('tier mapping helpers (#455 five-tier codomain)', () => {
    it('staticTierFor returns medium when capabilities are null (D6: never basic on silence)', () => {
      expect(staticTierFor(null)).toBe('medium');
    });

    it('staticTierFor returns basic for small texture budgets', () => {
      expect(staticTierFor({ maxTextureSize: 2048, renderer: 'something' })).toBe('basic');
    });

    it('staticTierFor returns basic for an integrated renderer', () => {
      expect(
        staticTierFor({ maxTextureSize: 16384, renderer: 'Intel Iris Xe Graphics' }),
      ).toBe('basic');
    });

    it('staticTierFor returns medium for an unknown or discrete renderer', () => {
      expect(staticTierFor({ maxTextureSize: 16384, renderer: 'Something new' })).toBe(
        'medium',
      );
    });

    it('staticTierFor never returns high or extra-high (user-elective, FR7)', () => {
      // Even the most capable-looking renderer gets `medium` at most from
      // the static heuristic; `high` / `extra-high` require a user pin.
      expect(staticTierFor({ maxTextureSize: 32768, renderer: 'NVIDIA RTX 4090' })).not.toBe('high');
      expect(staticTierFor({ maxTextureSize: 32768, renderer: 'NVIDIA RTX 4090' })).not.toBe('extra-high');
    });

    it('benchmarkTierFor demotes to basic on an expensive median frame', () => {
      expect(
        benchmarkTierFor(
          { framesRendered: 8, medianFrameMs: 42, wallClockMs: 300 },
          { maxTextureSize: 16384, renderer: 'Discrete' },
        ),
      ).toBe('basic');
    });

    it('benchmarkTierFor returns low for a middle median frame (10 < ms <= 20)', () => {
      expect(
        benchmarkTierFor(
          { framesRendered: 8, medianFrameMs: 15, wallClockMs: 120 },
          { maxTextureSize: 16384, renderer: 'Discrete' },
        ),
      ).toBe('low');
    });

    it('benchmarkTierFor stays at medium when the median is comfortably inside budget', () => {
      expect(
        benchmarkTierFor(
          { framesRendered: 8, medianFrameMs: 3, wallClockMs: 50 },
          { maxTextureSize: 16384, renderer: 'Discrete' },
        ),
      ).toBe('medium');
    });

    it('benchmarkTierFor is pinned to low when the static heuristic says basic', () => {
      // A clearing-the-10ms benchmark is one tier better than the static
      // read gave: low rather than basic.
      expect(
        benchmarkTierFor(
          { framesRendered: 8, medianFrameMs: 3, wallClockMs: 50 },
          { maxTextureSize: 2048, renderer: 'Intel UHD' },
        ),
      ).toBe('low');
    });
  });
});
