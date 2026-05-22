import { useRef, useCallback, useState } from 'react';
import type { PM5Data } from '../types';

export interface BoatState {
  velocityMps: number;
  positionM: number;
  /** 'catch' | 'drive' | 'finish' | 'recovery' */
  strokePhase: string;
  strokeCycleT: number;
  acceleration: number;
}

const DEFAULT_STATE: BoatState = {
  velocityMps: 0,
  positionM: 0,
  strokePhase: 'recovery',
  strokeCycleT: 0,
  acceleration: 0,
};

/**
 * Compute boat speed from PM5 pace using a simple JS formula.
 */
function jsSpeedFromPm5(pm5Data: PM5Data | null): number {
  if (!pm5Data?.pace || pm5Data.pace <= 0) return 0;
  return 500 / pm5Data.pace;
}

/**
 * usePhysicsEngine
 *
 * Provides physics simulation for boat movement based on PM5 data.
 * Currently uses a simple JavaScript pace-to-speed conversion.
 * Returns the latest BoatState and a `dispatchTick` function to advance
 * the simulation each animation frame.
 */
export function usePhysicsEngine() {
  const [boatState, setBoatState] = useState<BoatState>(DEFAULT_STATE);

  // Running JS position accumulator
  const jsPositionRef = useRef(0);

  /**
   * Advance the physics simulation by `dt` seconds using current PM5 data.
   * Returns the velocity in m/s.
   */
  const dispatchTick = useCallback(
    (dt: number, pm5Data: PM5Data | null): number => {
      // JS fallback: pace → speed, accumulate position.
      const speed = jsSpeedFromPm5(pm5Data);
      jsPositionRef.current += speed * dt;
      setBoatState((prev) => ({
        ...prev,
        velocityMps: speed,
        positionM: jsPositionRef.current,
        acceleration: dt > 0 ? (speed - prev.velocityMps) / dt : 0,
      }));
      return speed;
    },
    [],
  );

  const resetEngine = useCallback(() => {
    jsPositionRef.current = 0;
    setBoatState(DEFAULT_STATE);
  }, []);

  return { boatState, dispatchTick, resetEngine };
}
