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
    // No WebGL2, so the hook lands on the static fallback with tier=medium
    // (#455 D6: silence resolves to medium, never basic).
    expect(captured[captured.length - 1].tierAfterReady).toBe('medium');
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
    it('user-set basic always wins over the probe', () => {
      expect(resolvePerformanceModeFromProbe('basic', 'medium')).toBe('basic');
    });

    it('user-set extra-high always wins over the probe', () => {
      expect(resolvePerformanceModeFromProbe('extra-high', 'basic')).toBe('extra-high');
    });

    it('user-set auto defers to the probed tier', () => {
      expect(resolvePerformanceModeFromProbe('auto', 'basic')).toBe('basic');
    });

    it('user-set auto with a medium probe returns medium', () => {
      expect(resolvePerformanceModeFromProbe('auto', 'medium')).toBe('medium');
    });

    it('undefined user choice (undefined → auto) defers to the probed tier', () => {
      expect(resolvePerformanceModeFromProbe(undefined, 'basic')).toBe('basic');
    });

    it('a high/extra-high probed tier is treated as no-answer and falls through', () => {
      // The probe never returns high/extra-high today (FR7), but the resolver
      // defends against a future codomain by falling through to the global
      // default rather than silently promoting the scene.
      const highValue = resolvePerformanceModeFromProbe('auto', 'high');
      expect(['basic', 'low', 'medium']).toContain(highValue);
      const extraHighValue = resolvePerformanceModeFromProbe('auto', 'extra-high');
      expect(['basic', 'low', 'medium']).toContain(extraHighValue);
    });

    it('falls through to resolvePerformanceMode() when neither the user nor the probe decides', () => {
      const value = resolvePerformanceModeFromProbe('auto', null);
      expect(['basic', 'low', 'medium', 'high', 'extra-high']).toContain(value);
    });
  });
});
