import { test, expect } from '../fixtures/crash-watch';
import {
  SIM_PORTS_PER_WORKER,
  SIM_WS_BASE_PORT,
  simPortsForWorker,
  simPortsForWorkers,
} from '../utils/simPorts';

/**
 * The arithmetic behind one simulator per worker.
 *
 * It lives here rather than under `src/__tests__` because `vitest.config.ts`
 * excludes `playwright/**` — this is test infrastructure, not application
 * code. These cases open no browser and cost milliseconds; what they buy is
 * that two workers can never be handed the same port, which is the one way
 * this change could go wrong quietly. A clash would surface as a rower being
 * driven by someone else's test, and that reads as a physics bug.
 */
test.describe('simulator ports', () => {
  test('gives the first worker the ports everything already expects', () => {
    expect(simPortsForWorker(0)).toEqual({ ws: 9001, http: 9002 });
  });

  test('never hands two workers the same port', () => {
    const seen = new Set<number>();
    for (let worker = 0; worker < 32; worker += 1) {
      const { ws, http } = simPortsForWorker(worker);
      expect(seen.has(ws), `worker ${worker} reuses ws port ${ws}`).toBe(false);
      expect(seen.has(http), `worker ${worker} reuses http port ${http}`).toBe(false);
      seen.add(ws);
      seen.add(http);
    }
  });

  // `sim-server.js` serves its HTTP control endpoint on the port above the
  // WebSocket one, so a worker owns a pair and the next worker has to start
  // past it.
  test('leaves room for the HTTP endpoint above each WebSocket port', () => {
    const first = simPortsForWorker(0);
    const second = simPortsForWorker(1);

    expect(first.http).toBe(first.ws + 1);
    expect(second.ws).toBeGreaterThan(first.http);
    expect(second.ws - first.ws).toBe(SIM_PORTS_PER_WORKER);
  });

  test('starts where the simulator has always started', () => {
    expect(simPortsForWorker(0).ws).toBe(SIM_WS_BASE_PORT);
  });

  // Playwright's `workerIndex` is always a non-negative integer, but this is
  // the kind of helper that ends up called with whatever a caller has.
  test('treats nonsense as the first worker rather than a negative port', () => {
    for (const input of [-1, -100, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(simPortsForWorker(input), `${input} produced a bad port`).toEqual({
        ws: 9001,
        http: 9002,
      });
    }
  });

  test('rounds a fractional index rather than inventing a fractional port', () => {
    expect(simPortsForWorker(2.7)).toEqual(simPortsForWorker(2));
  });

  test('lists every port a run will occupy, so a cleanup step can clear them', () => {
    expect(simPortsForWorkers(3)).toEqual([9001, 9002, 9003, 9004, 9005, 9006]);
    expect(simPortsForWorkers(0)).toEqual([]);
  });
});
