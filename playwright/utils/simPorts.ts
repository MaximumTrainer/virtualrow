/**
 * Which ports a worker's PM5 simulator listens on.
 *
 * The simulator broadcasts every message to every socket connected to it —
 * that is what makes it useful, since a test can drive a whole session from
 * outside the page. It is also why the suite ran `workers: 1` for years: two
 * tests sharing one server would feed each other's rowers, and the failure
 * would look like a physics bug rather than a test one.
 *
 * A server per worker settles it. Playwright hands every worker a stable
 * `workerIndex`, so the ports can be derived rather than negotiated, and two
 * workers can never pick the same pair.
 */

/** The first worker's WebSocket port — the number the simulator has always used. */
export const SIM_WS_BASE_PORT = 9001;

/**
 * Ports reserved per worker.
 *
 * `sim-server.js` listens for WebSockets on the port it is given and serves
 * its HTTP control endpoint on the one above, so a worker owns two.
 */
export const SIM_PORTS_PER_WORKER = 2;

export interface SimPorts {
  /** Where the page's mock BLE layer connects. */
  ws: number;
  /** Where a spec posts sequences and routes. */
  http: number;
}

/**
 * The ports for a worker.
 *
 * Worker 0 gets 9001/9002, which is what every script, README and stale
 * terminal in this repository expects — so a single-worker run, and anyone
 * reading the docs, sees exactly what they saw before.
 */
export const simPortsForWorker = (workerIndex: number): SimPorts => {
  const safe = Number.isFinite(workerIndex) ? Math.max(0, Math.floor(workerIndex)) : 0;
  const ws = SIM_WS_BASE_PORT + safe * SIM_PORTS_PER_WORKER;
  return { ws, http: ws + 1 };
};

/** Every port a run of `count` workers will occupy, for a cleanup step to clear. */
export const simPortsForWorkers = (count: number): number[] => {
  const workers = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
  return Array.from({ length: workers }, (_, index) => simPortsForWorker(index)).flatMap(
    ({ ws, http }) => [ws, http],
  );
};
