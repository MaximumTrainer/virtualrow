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
      const prevPhase = boatStateRef.current.strokePhase;

      // Advance stroke cycle: cadence (spm) → fraction of cycle per second
      const cadenceSpm = pm5Data?.cadence ?? 20;
      const cycleFreq = cadenceSpm / 60;
      const newT = (boatStateRef.current.strokeCycleT + dt * cycleFreq) % 1.0;

      // Derive stroke phase from standardised boundaries
      let newPhase: string;
      if (newT < 0.15) newPhase = 'catch';
      else if (newT < 0.45) newPhase = 'drive';
      else if (newT < 0.55) newPhase = 'finish';
      else newPhase = 'recovery';

      boatStateRef.current = {
        ...boatStateRef.current,
        velocityMps: rawSpeed,
        smoothedVelocityMps: smoothedSpeedRef.current,
        positionM: jsPositionRef.current,
        acceleration: dt > 0 ? (rawSpeed - prevVelocity) / dt : 0,
        strokeCycleT: newT,
        strokePhase: newPhase,
      };

      // Trigger React re-render only on phase transitions (~2×/stroke)
      if (newPhase !== prevPhase) {
        setStrokePhase(newPhase);
      }

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
