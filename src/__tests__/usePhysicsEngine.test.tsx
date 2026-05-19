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

    expect(result.current.boatState.velocityMps).toBe(2);
    expect(result.current.boatState.positionM).toBe(4);
    expect(result.current.boatState.acceleration).toBe(1);
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

    expect(result.current.boatState).toEqual({
      velocityMps: 0,
      positionM: 0,
      strokePhase: 'recovery',
      strokeCycleT: 0,
      acceleration: 0,
    });
  });
});
