import { useEffect, useMemo, useState } from 'react';
import {
  IS_TEST_MODE,
  isTelemetryPublished,
  normalizePerformanceModeOverride,
  resolvePerformanceMode,
  type PerformanceMode,
} from '../components/rower3d/constants';
import {
  runDeviceProbe,
  type DevicePerformanceProbeOptions,
  type DevicePerformanceResult,
} from '../utils/devicePerformanceProbe';

/**
 * #454 Phase 2 — the React seam for the device-performance probe.
 *
 * `App.tsx` calls this once on first mount. Until the probe resolves, the
 * hook returns `{ ready: false, result: null }` and the app withholds the
 * `<Rower3D>` canvas for the selected route (NFR2: resolve the tier before
 * the scene mounts). After the probe resolves — synchronously in the common
 * case because the whole probe runs under 200 ms — the hook returns
 * `ready: true` with the full result; `result.tier` is what
 * `useGraphicsQuality`'s `auto` becomes for this device.
 *
 * The hook never throws: probe errors fall back to a safe `auto` default
 * (D6), which is what the Row screen sees today when no probe runs.
 *
 * Tier-generic: the hook returns `DevicePerformanceResult`, whose `tier` is
 * typed `PerformanceMode`. Widening `PerformanceMode` for #455 does not
 * require any change here.
 */

export interface DevicePerformanceState {
  ready: boolean;
  result: DevicePerformanceResult | null;
}

export interface UseDevicePerformanceOptions
  extends Omit<
    DevicePerformanceProbeOptions,
    'explicitPerformanceMode' | 'testSuppressed' | 'telemetryEnabled'
  > {
  /** Test-mode override. In production, defaults from the globals above. */
  explicitPerformanceMode?: DevicePerformanceProbeOptions['explicitPerformanceMode'];
  testSuppressed?: boolean;
  telemetryEnabled?: boolean;
  /**
   * When true, the probe runs synchronously inside the first render. Used by
   * static tests that want the ready state in the same render; omit in the
   * app so the Row screen first renders without blocking on the probe.
   */
  synchronous?: boolean;
}

const resolveExplicit = (): DevicePerformanceProbeOptions['explicitPerformanceMode'] => {
  if (typeof window === 'undefined') return null;
  return normalizePerformanceModeOverride(window.__VIRTUALROW_PERFORMANCE_MODE);
};

export function useDevicePerformance(
  options: UseDevicePerformanceOptions = {},
): DevicePerformanceState {
  const { synchronous = false, ...probeOverrides } = options;

  const probeArgs = useMemo<DevicePerformanceProbeOptions>(
    () => {
      const explicit = probeOverrides.explicitPerformanceMode ?? resolveExplicit();
      return {
        ...probeOverrides,
        explicitPerformanceMode: explicit,
        // Test-suppressed when IS_TEST_MODE and no user pin. We cannot use
        // hasExplicitPerformanceMode() here: it treats IS_TEST_MODE itself as
        // "explicit", so `IS_TEST_MODE && !hasExplicitPerformanceMode()` is
        // always false under Playwright and the benchmark would run, opening
        // a WebGL2 context the #261 gl-context-budget guard counts.
        testSuppressed:
          probeOverrides.testSuppressed ?? (IS_TEST_MODE && !explicit),
        telemetryEnabled:
          probeOverrides.telemetryEnabled ?? isTelemetryPublished(),
      };
    },
    // Probe inputs are read once at boot; downstream users cannot change them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const [state, setState] = useState<DevicePerformanceState>(() => {
    if (!synchronous) return { ready: false, result: null };
    const result = runProbeSafe(probeArgs);
    return { ready: true, result };
  });

  useEffect(() => {
    if (state.ready) return;
    // Run after mount so the Row screen renders its skeleton once first.
    const result = runProbeSafe(probeArgs);
    setState({ ready: true, result });
  }, [state.ready, probeArgs]);

  return state;
}

const runProbeSafe = (
  options: DevicePerformanceProbeOptions,
): DevicePerformanceResult => {
  try {
    return runDeviceProbe(options);
  } catch {
    // D6 / FR7: probe failure never propagates into the React tree.
    return {
      tier: 'medium',
      source: 'static',
      capabilities: null,
      fingerprint: 'probe-threw',
    };
  }
};

/**
 * Convenience: a mode handed to the scene given the user's choice and the
 * probe. User-set `basic` / `low` / `medium` / `high` / `extra-high` always
 * wins; `auto` becomes the probed tier (which under #455 is one of
 * `basic` / `low` / `medium` — the top two tiers stay user-elective per
 * #345 / FR7).
 *
 * Widened for #455. The App call-site stays the same shape.
 */
export const resolvePerformanceModeFromProbe = (
  userChoice: 'auto' | PerformanceMode | undefined,
  probedTier: PerformanceMode | null,
): PerformanceMode => {
  if (userChoice && userChoice !== 'auto') return userChoice;
  // The probe is allowed to return `basic`, `low` or `medium` (FR7).
  // Anything else — null, or a `high`/`extra-high` from a future codomain —
  // falls through to the global default so Playwright
  // (`__PLAYWRIGHT_TESTING` makes `resolvePerformanceMode()` return `basic`)
  // stays on basic and the visual baseline matches.
  if (probedTier && probedTier !== 'high' && probedTier !== 'extra-high') return probedTier;
  return resolvePerformanceMode();
};
