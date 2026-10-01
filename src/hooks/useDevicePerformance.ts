import { useEffect, useMemo, useState } from 'react';
import {
  hasExplicitPerformanceMode,
  IS_TEST_MODE,
  isTelemetryPublished,
  resolvePerformanceMode,
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
  const override = window.__VIRTUALROW_PERFORMANCE_MODE;
  if (override === 'low' || override === 'auto' || override === 'high') return override;
  // IS_TEST_MODE is handled through testSuppressed below; a tier is derived
  // from `resolvePerformanceMode()` only when the pin is set, so we return
  // null here so the caller can decide to suppress the benchmark instead.
  return null;
};

export function useDevicePerformance(
  options: UseDevicePerformanceOptions = {},
): DevicePerformanceState {
  const { synchronous = false, ...probeOverrides } = options;

  const probeArgs = useMemo<DevicePerformanceProbeOptions>(
    () => ({
      ...probeOverrides,
      explicitPerformanceMode:
        probeOverrides.explicitPerformanceMode ?? resolveExplicit(),
      testSuppressed:
        probeOverrides.testSuppressed ?? (IS_TEST_MODE && !hasExplicitPerformanceMode()),
      telemetryEnabled:
        probeOverrides.telemetryEnabled ?? isTelemetryPublished(),
    }),
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
      tier: 'auto',
      source: 'static',
      capabilities: null,
      fingerprint: 'probe-threw',
    };
  }
};

/**
 * Convenience: a mode handed to the scene given the user's choice and the
 * probe. User-set `low` / `high` always wins; `auto` becomes the probed tier.
 *
 * Keep this co-located with the hook: when #455 widens `PerformanceMode`,
 * only the hook's output type and this seam change — the App call-site stays
 * the same shape.
 */
export const resolvePerformanceModeFromProbe = (
  userChoice: 'low' | 'auto' | 'high' | undefined,
  probedTier: 'low' | 'auto' | 'high' | null,
): 'low' | 'auto' | 'high' => {
  if (userChoice && userChoice !== 'auto') return userChoice;
  if (probedTier) return probedTier;
  return resolvePerformanceMode();
};
