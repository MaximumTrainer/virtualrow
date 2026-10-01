import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import React from 'react';
import {
  resolvePerformanceModeFromProbe,
  useDevicePerformance,
} from '../hooks/useDevicePerformance';

/**
 * #454 Phase 2 — hook-level gates on {@link useDevicePerformance}.
 *
 * The hook is a thin React wrapper over the pure probe module. Tests here
 * assert the two things only the hook does: synchronous vs post-mount
 * resolution, and the user-choice-wins seam exposed by
 * {@link resolvePerformanceModeFromProbe}.
 */

interface Harness {
  readyAfterCommit: boolean;
  tierAfterReady: string | null;
}

const captureProbe = (
  options: Parameters<typeof useDevicePerformance>[0],
  onCapture: (snapshot: Harness) => void,
): React.FC => {
  const Component: React.FC = () => {
    const state = useDevicePerformance(options);
    React.useEffect(() => {
      if (state.ready) {
        onCapture({
          readyAfterCommit: true,
          tierAfterReady: state.result?.tier ?? null,
        });
      }
    }, [state]);
    return <div data-testid="probe-ready">{state.ready ? 'ready' : 'pending'}</div>;
  };
  return Component;
};

describe('useDevicePerformance (#454 Phase 2)', () => {
  beforeEach(() => {
    localStorage.clear();
    delete (window as unknown as { __PLAYWRIGHT_TESTING?: boolean }).__PLAYWRIGHT_TESTING;
    delete (window as unknown as { __VIRTUALROW_PERFORMANCE_MODE?: unknown })
      .__VIRTUALROW_PERFORMANCE_MODE;
    delete (window as unknown as { __VIRTUALROW_TELEMETRY?: boolean }).__VIRTUALROW_TELEMETRY;
    delete (window as unknown as { __VIRTUALROW_DEVICE_PROBE?: unknown })
      .__VIRTUALROW_DEVICE_PROBE;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('AC4 (FR2, NFR2): resolves after mount and surfaces the probed tier', async () => {
    const captured: Harness[] = [];
    const Harness = captureProbe(
      { openContext: () => null },
      (snap) => captured.push(snap),
    );
    const { getByTestId } = render(<Harness />);
    await waitFor(() => {
      expect(getByTestId('probe-ready').textContent).toBe('ready');
    });
    expect(captured.length).toBeGreaterThan(0);
    // No WebGL2, so the hook lands on the static fallback with tier=auto.
    expect(captured[captured.length - 1].tierAfterReady).toBe('auto');
  });

  it('synchronous: true returns a ready state inside the first render for App tests', () => {
    const Harness = captureProbe(
      { openContext: () => null, synchronous: true },
      () => undefined,
    );
    const { getByTestId } = render(<Harness />);
    // In synchronous mode the hook's initial state is already ready.
    expect(getByTestId('probe-ready').textContent).toBe('ready');
  });

  describe('resolvePerformanceModeFromProbe', () => {
    it('user-set low always wins over the probe', () => {
      expect(resolvePerformanceModeFromProbe('low', 'auto')).toBe('low');
    });

    it('user-set high always wins over the probe', () => {
      expect(resolvePerformanceModeFromProbe('high', 'low')).toBe('high');
    });

    it('user-set auto defers to the probed tier', () => {
      expect(resolvePerformanceModeFromProbe('auto', 'low')).toBe('low');
    });

    it('undefined user choice (undefined → auto) defers to the probed tier', () => {
      expect(resolvePerformanceModeFromProbe(undefined, 'low')).toBe('low');
    });

    it('falls through to resolvePerformanceMode() when neither the user nor the probe decides', () => {
      // The default under non-Playwright is `auto`; we only care that this
      // path is safe (no throw) and returns one of the three legal tiers.
      const value = resolvePerformanceModeFromProbe('auto', null);
      expect(['low', 'auto', 'high']).toContain(value);
    });
  });
});
