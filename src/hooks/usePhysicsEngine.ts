import { useRef, useCallback, useState } from 'react';
import type { PM5Data } from '../types';

export interface BoatState {
  velocityMps: number;
  smoothedVelocityMps: number;
  positionM: number;
  /** 'catch' | 'drive' | 'finish' | 'recovery' */
  strokePhase: string;
  strokeCycleT: number;
  acceleration: number;
}

const DEFAULT_STATE: BoatState = {
  velocityMps: 0,
  smoothedVelocityMps: 0,
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
 * Returns boatStateRef (mutable, no re-render) and strokePhase (state,
 * triggers re-render only on phase transitions ~2×/stroke). This avoids
 * the ~60 Hz React re-renders that a per-frame setState would cause.
 */
export function usePhysicsEngine() {
  const boatStateRef = useRef<BoatState>({ ...DEFAULT_STATE });
  const [strokePhase, setStrokePhase] = useState<string>('recovery');

  // Running JS position accumulator and LPF state
  const jsPositionRef = useRef(0);
  const smoothedSpeedRef = useRef(0);
  /** Low-pass filter time constant (seconds). */
  const LPF_TAU = 0.5;

  const dispatchTick = useCallback(
    (dt: number, pm5Data: PM5Data | null): number => {
      const rawSpeed = jsSpeedFromPm5(pm5Data);

      // One-pole low-pass: smoothed += (raw - smoothed) * (1 - exp(-dt/tau))
      const alpha = 1 - Math.exp(-dt / LPF_TAU);
      smoothedSpeedRef.current += (rawSpeed - smoothedSpeedRef.current) * alpha;

      // Accumulate position using raw speed for accuracy
      jsPositionRef.current += rawSpeed * dt;

      const prevVelocity = boatStateRef.current.velocityMps;
      boatStateRef.current = {
        ...boatStateRef.current,
        velocityMps: rawSpeed,
        smoothedVelocityMps: smoothedSpeedRef.current,
        positionM: jsPositionRef.current,
        acceleration: dt > 0 ? (rawSpeed - prevVelocity) / dt : 0,
      };

      return rawSpeed;
    },
    [],
  );

  const resetEngine = useCallback(() => {
    jsPositionRef.current = 0;
    smoothedSpeedRef.current = 0;
    boatStateRef.current = { ...DEFAULT_STATE };
    setStrokePhase('recovery');
  }, []);

  /** Call from useFrame when stroke phase transitions. Re-renders are O(1/stroke). */
  const updateStrokePhase = useCallback((phase: string) => {
    if (boatStateRef.current.strokePhase !== phase) {
      boatStateRef.current = { ...boatStateRef.current, strokePhase: phase };
      setStrokePhase(phase);
    }
  }, []);

  return { boatStateRef, strokePhase, dispatchTick, resetEngine, updateStrokePhase };
}
