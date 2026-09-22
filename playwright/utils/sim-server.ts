import * as child_process from 'child_process';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { simPortsForWorker } from './simPorts';

/**
 * Lifecycle for the PM5/FTMS simulator that feeds the mock BLE layer.
 *
 * Extracted from virtualrow.spec.ts, which grew this first and still owns its
 * own copy — this module exists so a second spec can depend on the simulator
 * without duplicating eighty lines of process management. The behaviour is
 * unchanged: CI starts the server in the workflow, so a spec only waits for it;
 * locally the spec starts one itself.
 *
 * A spec that needs the rower to actually move needs this. Without frames
 * arriving, the scene draws once and then idles — sampledAt stays frozen and
 * progress stays at zero, which looks exactly like a renderer that has stopped.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * This worker's simulator ports.
 *
 * `TEST_PARALLEL_INDEX` is the value Playwright provides for exactly this -
 * allocating a resource per worker. It stays inside `[0, workers)` however
 * many times a worker is restarted, which `TEST_WORKER_INDEX` does not, so a
 * crash mid-run cannot walk the ports off into a range nothing cleans up.
 *
 * An explicit `SIM_WS_PORT` still wins, for anyone driving the simulator by
 * hand.
 */
const workerPorts = simPortsForWorker(Number(process.env.TEST_PARALLEL_INDEX ?? 0));

export const SIM_WS_PORT = parseInt(
  process.env.SIM_WS_PORT || String(workerPorts.ws),
  10,
);
export const SIM_HTTP_PORT = parseInt(
  process.env.SIM_HTTP_PORT || String(workerPorts.http),
  10,
);

const simServerPath = path.resolve(__dirname, '../simulators/sim-server.cjs');

let simProcess: child_process.ChildProcess | undefined;

/** Best-effort port cleanup, used on EADDRINUSE. */
async function killPortProcess(port: number): Promise<void> {
  return new Promise((resolve) => {
    let kill: child_process.ChildProcess;
    if (process.platform === 'win32') {
      kill = child_process.spawn(
        'cmd',
        [
          '/c',
          `for /f "tokens=5" %p in ('netstat -ano ^| findstr :${port}') do taskkill /PID %p /F 2>nul`,
        ],
        { stdio: 'ignore', shell: true },
      );
    } else {
      kill = child_process.spawn(
        'sh',
        [
          '-c',
          `pids=$(lsof -ti :${port}); if [ -n "$pids" ]; then kill -TERM $pids 2>/dev/null; sleep 0.5; kill -9 $pids 2>/dev/null || true; fi`,
        ],
        { stdio: 'ignore' },
      );
    }
    kill.on('close', () => resolve());
    kill.on('error', () => resolve());
    setTimeout(() => resolve(), 2000);
  });
}

/** Wait until the simulator answers on its HTTP port. */
export async function ensureSimServerStarted(maxRetries = 30): Promise<boolean> {
  const url = `http://localhost:${SIM_HTTP_PORT}`;
  for (let i = 0; i < maxRetries; i += 1) {
    try {
      const res = await fetch(url);
      if (res.ok) return true;
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  return false;
}

/**
 * Make the simulator available for this spec file.
 *
 * Returns whether it is reachable. Callers decide what an unreachable
 * simulator means for them rather than having a throw imposed here: a spec
 * that only reads telemetry can still say something useful without one.
 */
export async function useSimServer(): Promise<boolean> {
  if (await ensureSimServerStarted(5)) return true;

  await killPortProcess(SIM_WS_PORT);
  await killPortProcess(SIM_HTTP_PORT);
  await new Promise((r) => setTimeout(r, 500));

  simProcess = child_process.spawn('node', [simServerPath], {
    env: {
      ...process.env,
      SIM_WS_PORT: String(SIM_WS_PORT),
      SIM_HTTP_PORT: String(SIM_HTTP_PORT),
      PORT: String(SIM_WS_PORT),
    },
    stdio: 'ignore',
  });
  simProcess.on('error', () => {
    simProcess = undefined;
  });

  return ensureSimServerStarted();
}

/** Stop a simulator this module started; a CI-provided one is left alone. */
export async function releaseSimServer(): Promise<void> {
  if (simProcess) {
    simProcess.kill();
    simProcess = undefined;
  }
}

/** Push one PM5 frame through the simulator, which owns the wire format. */
export async function emitPm5(payload: Record<string, number>): Promise<boolean> {
  try {
    const res = await fetch(`http://localhost:${SIM_HTTP_PORT}/emit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'pm5', payload }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
