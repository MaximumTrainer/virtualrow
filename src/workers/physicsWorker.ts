/**
 * Physics Web Worker
 *
 * Hosts the Rust/Wasm physics engine in a dedicated thread.
 * The main thread sends TICK messages and receives STATE messages back.
 *
 * Message protocol:
 *   IN  { type: 'INIT' }
 *   IN  { type: 'TICK', dt: number, watts: number, spm: number, pm5DistanceM: number, tickId?: number }
 *   IN  { type: 'RESET' }
 *   OUT { type: 'STATE', velocityMps, positionM, strokePhase, strokeCycleT, acceleration, tickId?, latencyMs? }
 *   OUT { type: 'READY' }
 *   OUT { type: 'ERROR', message: string }
 */

import init, {
  PhysicsConfig,
  PhysicsEngine,
  RowingMetrics,
  StrokePhase,
} from '../wasm-pkg/virtualrow_physics.js';

// Numeric StrokePhase enum values from Wasm → string names for JS consumers
const PHASE_NAMES: Record<number, string> = {
  [StrokePhase.Catch]: 'catch',
  [StrokePhase.Drive]: 'drive',
  [StrokePhase.Finish]: 'finish',
  [StrokePhase.Recovery]: 'recovery',
};

let engine: PhysicsEngine | null = null;

async function initialise() {
  try {
    await init();
    const cfg = new PhysicsConfig();
    engine = new PhysicsEngine(cfg);
    // cfg ownership transferred to PhysicsEngine — do not call cfg.free()
    self.postMessage({ type: 'READY' });
  } catch (err) {
    self.postMessage({ type: 'ERROR', message: String(err) });
  }
}

self.addEventListener('message', (event: MessageEvent) => {
  const msg = event.data as Record<string, unknown>;

  switch (msg.type) {
    case 'INIT':
      initialise();
      break;

    case 'TICK': {
      if (!engine) {
        self.postMessage({ type: 'ERROR', message: 'Engine not initialised' });
        return;
      }
      const tickStart = performance.now();
      const metrics = new RowingMetrics(
        (msg.watts as number) ?? 0,
        (msg.spm as number) ?? 0,
        (msg.pm5DistanceM as number) ?? 0,
      );
      const state = engine.tick(msg.dt as number, metrics);
      const tickMs = performance.now() - tickStart;
      self.postMessage({
        type: 'STATE',
        velocityMps: state.velocity_mps,
        positionM: state.position_m,
        strokePhase: PHASE_NAMES[state.stroke_phase] ?? 'recovery',
        strokeCycleT: state.stroke_cycle_t,
        acceleration: state.acceleration,
        // Echo tickId so the hook can compute round-trip latency
        tickId: msg.tickId,
        // Worker-side engine tick duration (excludes postMessage overhead)
        engineMs: tickMs,
      });
      state.free();
      metrics.free();
      break;
    }

    case 'RESET':
      engine?.reset();
      break;

    default:
      self.postMessage({ type: 'ERROR', message: `Unknown message type: ${msg.type}` });
  }
});

// Auto-initialise on load so callers just need to post TICK messages.
initialise();
