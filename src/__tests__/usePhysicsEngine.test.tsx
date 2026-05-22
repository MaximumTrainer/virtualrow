import { describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { usePhysicsEngine } from '../hooks/usePhysicsEngine';

describe('usePhysicsEngine', () => {
  it('updates boat velocity and position from pace data', () => {
    const { result } = renderHook(() => usePhysicsEngine());

    act(() => {
      result.current.dispatchTick(2, {
        pace: 250,
        power: undefined,
        cadence: 24,
        distance: 0,
        elapsedTime: 0,
      });
    });

    expect(result.current.boatStateRef.current.velocityMps).toBe(2);
    expect(result.current.boatStateRef.current.positionM).toBe(4);
    expect(result.current.boatStateRef.current.acceleration).toBe(1);
  });

  it('resets boat state and position accumulator', () => {
    const { result } = renderHook(() => usePhysicsEngine());

    act(() => {
      result.current.dispatchTick(1, {
        pace: 250,
        power: undefined,
        cadence: 24,
        distance: 0,
        elapsedTime: 0,
      });
      result.current.resetEngine();
    });

    expect(result.current.boatStateRef.current).toEqual({
      velocityMps: 0,
      smoothedVelocityMps: 0,
      positionM: 0,
      strokePhase: 'recovery',
      strokeCycleT: 0,
      acceleration: 0,
    });
  });

  it('applies low-pass filter to smooth velocity', () => {
    const { result } = renderHook(() => usePhysicsEngine());

    // After one tick, smoothedVelocityMps should be between 0 and raw speed
    act(() => {
      result.current.dispatchTick(0.016, { pace: 250, power: undefined, cadence: 24, distance: 0, elapsedTime: 0 });
    });

    const raw = result.current.boatStateRef.current.velocityMps;
    const smoothed = result.current.boatStateRef.current.smoothedVelocityMps;
    expect(raw).toBe(2);
    expect(smoothed).toBeGreaterThan(0);
    expect(smoothed).toBeLessThan(raw);
  });

  it('smoothed velocity converges to raw after many ticks', () => {
    const { result } = renderHook(() => usePhysicsEngine());

    // 500 ticks × 16ms = 8s ≈ 16 time constants (tau=0.5s): exp(-16) < 1e-6
    act(() => {
      for (let i = 0; i < 500; i++) {
        result.current.dispatchTick(0.016, { pace: 250, power: undefined, cadence: 24, distance: 0, elapsedTime: 0 });
      }
    });

    const raw = result.current.boatStateRef.current.velocityMps;
    const smoothed = result.current.boatStateRef.current.smoothedVelocityMps;
    expect(raw).toBe(2);
    expect(smoothed).toBeCloseTo(2, 3);
  });

  it('updateStrokePhase triggers re-render only on phase change', () => {
    const { result } = renderHook(() => usePhysicsEngine());

    act(() => {
      result.current.updateStrokePhase('catch');
    });
    expect(result.current.strokePhase).toBe('catch');
    expect(result.current.boatStateRef.current.strokePhase).toBe('catch');

    // Calling with same phase again should not change anything
    act(() => {
      result.current.updateStrokePhase('catch');
    });
    expect(result.current.strokePhase).toBe('catch');
  });

  describe('strokeCycleT advancement', () => {
    it('advances strokeCycleT proportionally to cadence and dt', () => {
      const { result } = renderHook(() => usePhysicsEngine());

      // 20 spm → 1/3 cycle per second → after 1s should be ≈0.333
      act(() => {
        result.current.dispatchTick(1, {
          pace: 250,
          power: undefined,
          cadence: 20,
          distance: 0,
          elapsedTime: 0,
        });
      });

      expect(result.current.boatStateRef.current.strokeCycleT).toBeCloseTo(20 / 60, 5);
    });

    it('wraps strokeCycleT back to 0 after a full cycle', () => {
      const { result } = renderHook(() => usePhysicsEngine());

      // 60 spm → 1 cycle per second → after 1s should wrap to 0
      act(() => {
        result.current.dispatchTick(1, {
          pace: 250,
          power: undefined,
          cadence: 60,
          distance: 0,
          elapsedTime: 0,
        });
      });

      expect(result.current.boatStateRef.current.strokeCycleT).toBeCloseTo(0, 5);
    });

    it('accumulates strokeCycleT across multiple ticks', () => {
      const { result } = renderHook(() => usePhysicsEngine());

      const pm5 = { pace: 250, power: undefined as undefined, cadence: 20, distance: 0, elapsedTime: 0 };
      // 20 spm → cycleFreq = 1/3 Hz
      // After 10 ticks × 0.1s: newT = (10 * 0.1 * 20/60) % 1 ≈ 0.333
      act(() => {
        for (let i = 0; i < 10; i++) {
          result.current.dispatchTick(0.1, pm5);
        }
      });

      const expected = (10 * 0.1 * (20 / 60)) % 1.0;
      expect(result.current.boatStateRef.current.strokeCycleT).toBeCloseTo(expected, 3);
    });
  });

  describe('strokePhase derivation from strokeCycleT', () => {
    it('t < 0.15 → catch', () => {
      const { result } = renderHook(() => usePhysicsEngine());
      // 20 spm, dt = 0.1s → newT = 20/60 * 0.1 ≈ 0.033 (catch)
      act(() => {
        result.current.dispatchTick(0.1, {
          pace: 250, power: undefined, cadence: 20, distance: 0, elapsedTime: 0,
        });
      });
      expect(result.current.boatStateRef.current.strokeCycleT).toBeLessThan(0.15);
      expect(result.current.boatStateRef.current.strokePhase).toBe('catch');
    });

    it('t in 0.15–0.45 → drive', () => {
      const { result } = renderHook(() => usePhysicsEngine());
      // Use a large cadence/dt to land in drive band: e.g. 180 spm × 0.1s = 0.3
      act(() => {
        result.current.dispatchTick(0.1, {
          pace: 250, power: undefined, cadence: 180, distance: 0, elapsedTime: 0,
        });
      });
      const t = result.current.boatStateRef.current.strokeCycleT;
      expect(t).toBeGreaterThanOrEqual(0.15);
      expect(t).toBeLessThan(0.45);
      expect(result.current.boatStateRef.current.strokePhase).toBe('drive');
    });

    it('t in 0.45–0.55 → finish', () => {
      const { result } = renderHook(() => usePhysicsEngine());
      // 300 spm × 0.1s = 0.5 → finish
      act(() => {
        result.current.dispatchTick(0.1, {
          pace: 250, power: undefined, cadence: 300, distance: 0, elapsedTime: 0,
        });
      });
      const t = result.current.boatStateRef.current.strokeCycleT;
      expect(t).toBeGreaterThanOrEqual(0.45);
      expect(t).toBeLessThan(0.55);
      expect(result.current.boatStateRef.current.strokePhase).toBe('finish');
    });

    it('t >= 0.55 → recovery', () => {
      const { result } = renderHook(() => usePhysicsEngine());
      // 480 spm × 0.1s = 0.8 → recovery
      act(() => {
        result.current.dispatchTick(0.1, {
          pace: 250, power: undefined, cadence: 480, distance: 0, elapsedTime: 0,
        });
      });
      const t = result.current.boatStateRef.current.strokeCycleT;
      expect(t).toBeGreaterThanOrEqual(0.55);
      expect(result.current.boatStateRef.current.strokePhase).toBe('recovery');
    });

    it('uses fallback cadence of 20 spm when cadence is absent', () => {
      const { result } = renderHook(() => usePhysicsEngine());
      act(() => {
        result.current.dispatchTick(1, {
          pace: 250, power: undefined, cadence: undefined, distance: 0, elapsedTime: 0,
        });
      });
      // 20 spm default → newT = 20/60 ≈ 0.333 → drive
      expect(result.current.boatStateRef.current.strokeCycleT).toBeCloseTo(20 / 60, 4);
      expect(result.current.boatStateRef.current.strokePhase).toBe('drive');
    });

    it('strokePhase React state updates on phase transition', () => {
      const { result } = renderHook(() => usePhysicsEngine());
      // Drive phase transition
      act(() => {
        result.current.dispatchTick(0.1, {
          pace: 250, power: undefined, cadence: 180, distance: 0, elapsedTime: 0,
        });
      });
      expect(result.current.strokePhase).toBe('drive');
    });
  });
});
