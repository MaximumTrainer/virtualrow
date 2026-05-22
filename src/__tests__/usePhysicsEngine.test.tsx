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
});
