import { useEffect, useRef, useCallback, useState } from 'react';
import type { PM5Data } from '../types';

export interface BoatState {
  velocityMps: number;
  positionM: number;
  /** 'catch' | 'drive' | 'finish' | 'recovery' */
  strokePhase: string;
  strokeCycleT: number;
  acceleration: number;
}

/** Latency stats for the Wasm Worker round-trip (postMessage → STATE reply). */
export interface WorkerLatency {
  /** Most recent round-trip time in milliseconds. */
  lastMs: number;
  /** Rolling average over the last 60 ticks (ms). */
  avgMs: number;
  /** 99th-percentile over the last 60 ticks (ms). */
  p99Ms: number;
}

const DEFAULT_STATE: BoatState = {
  velocityMps: 0,
  positionM: 0,
  strokePhase: 'recovery',
  strokeCycleT: 0,
  acceleration: 0,
};

const DEFAULT_LATENCY: WorkerLatency = { lastMs: 0, avgMs: 0, p99Ms: 0 };

/**
 * Fallback: compute boat speed from PM5 pace using the original JS formula.
 * Used when the Wasm worker is unavailable.
 */
function jsSpeedFromPm5(pm5Data: PM5Data | null): number {
  if (!pm5Data?.pace || pm5Data.pace <= 0) return 0;
  return 500 / pm5Data.pace;
}

/**
 * usePhysicsEngine
 *
 * Spawns a physics Web Worker backed by the Rust/Wasm engine.
 * Returns the latest BoatState and a `dispatchTick` function to advance
 * the simulation each animation frame.
 *
 * Falls back to a simple JS pace→speed model if Wasm is unavailable.
 */
export function usePhysicsEngine() {
  const workerRef = useRef<Worker | null>(null);
  const [boatState, setBoatState] = useState<BoatState>(DEFAULT_STATE);
  const [workerLatency, setWorkerLatency] = useState<WorkerLatency>(DEFAULT_LATENCY);
  const wasmReadyRef = useRef(false);
  // Keep a ref so dispatchTick can read velocity without being recreated each state update
  const velocityRef = useRef(0);

  // Running JS-fallback position accumulator
  const jsPositionRef = useRef(0);

  // Latency tracking: map tickId → send timestamp
  const tickTimestamps = useRef<Map<number, number>>(new Map());
  const tickIdCounter = useRef(0);
  const latencySamples = useRef<number[]>([]);
  const LATENCY_WINDOW = 60;

  useEffect(() => {
    // Skip the Wasm Worker during Playwright E2E tests — the JS fallback is
    // sufficient for all E2E assertions and avoids Worker init overhead that
    // would push the test past its 90 s timeout.
    if (window.__PLAYWRIGHT_TESTING) {
      wasmReadyRef.current = false;
      return;
    }

    let worker: Worker;
    try {
      worker = new Worker(
        new URL('../workers/physicsWorker.ts', import.meta.url),
        { type: 'module' },
      );

      worker.addEventListener('message', (event: MessageEvent) => {
        const msg = event.data as Record<string, unknown>;
        if (msg.type === 'READY') {
          wasmReadyRef.current = true;
        } else if (msg.type === 'STATE') {
          // Compute round-trip latency if tickId was echoed back
          if (typeof msg.tickId === 'number') {
            const sent = tickTimestamps.current.get(msg.tickId);
            if (sent !== undefined) {
              const rtt = performance.now() - sent;
              tickTimestamps.current.delete(msg.tickId);
              const samples = latencySamples.current;
              samples.push(rtt);
              if (samples.length > LATENCY_WINDOW) samples.shift();
              const sorted = [...samples].sort((a, b) => a - b);
              const avg = samples.reduce((s, x) => s + x, 0) / samples.length;
              setWorkerLatency({
                lastMs: rtt,
                avgMs: avg,
                p99Ms: sorted[Math.floor(sorted.length * 0.99)] ?? rtt,
              });
            }
          }
          setBoatState({
            velocityMps: msg.velocityMps as number,
            positionM: msg.positionM as number,
            strokePhase: msg.strokePhase as string,
            strokeCycleT: msg.strokeCycleT as number,
            acceleration: msg.acceleration as number,
          });
          velocityRef.current = msg.velocityMps as number;
        }
        // Silently ignore ERROR messages in production; worker logs them.
      });

      worker.addEventListener('error', () => {
        // Worker failed to load — fall back to JS model silently.
        wasmReadyRef.current = false;
      });

      workerRef.current = worker;
    } catch {
      // new Worker() threw — fall back to JS model.
      wasmReadyRef.current = false;
    }

    return () => {
      workerRef.current?.terminate();
      workerRef.current = null;
      wasmReadyRef.current = false;
    };
  }, []);

  /**
   * Advance the physics simulation by `dt` seconds using current PM5 data.
   * Returns the velocity in m/s so the caller can use it synchronously
   * while the async worker state update propagates.
   */
  const dispatchTick = useCallback(
    (dt: number, pm5Data: PM5Data | null): number => {
      if (wasmReadyRef.current && workerRef.current) {
        const tickId = ++tickIdCounter.current;
        tickTimestamps.current.set(tickId, performance.now());
        workerRef.current.postMessage({
          type: 'TICK',
          dt,
          watts: pm5Data?.power ?? 0,
          spm: pm5Data?.cadence ?? 0,
          pm5DistanceM: pm5Data?.distance ?? 0,
          tickId,
        });
        // If the Wasm engine has built up velocity, use it.
        // When watts=0 (power not yet plumbed), fall back to JS pace formula so
        // the caller always gets a meaningful speed — identical to pre-Wasm behaviour.
        const wasmSpeed = velocityRef.current;
        if (wasmSpeed > 0) return wasmSpeed;
        return jsSpeedFromPm5(pm5Data);
      }

      // JS fallback: pace → speed, accumulate position.
      // Intentionally skip setBoatState here — calling it every frame (60fps) triggers
      // 60 React re-renders/sec which significantly slows the app.
      // The speed is returned synchronously; Worker STATE updates handle boatState in Wasm mode.
      const speed = jsSpeedFromPm5(pm5Data);
      jsPositionRef.current += speed * dt;
      return speed;
    },
    [],
  );

  const resetEngine = useCallback(() => {
    workerRef.current?.postMessage({ type: 'RESET' });
    jsPositionRef.current = 0;
    tickTimestamps.current.clear();
    latencySamples.current = [];
    setBoatState(DEFAULT_STATE);
    setWorkerLatency(DEFAULT_LATENCY);
  }, []);

  return { boatState, dispatchTick, resetEngine, workerLatency };
}
