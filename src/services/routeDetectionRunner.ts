/**
 * #493 D23 b: where route detection runs. A Web Worker by default, so building
 * the mask and casting rays for a long route never blocks the scene; inline
 * wherever a worker can't be made (jsdom, an old browser, a blocked script),
 * dies, can't read the message, or doesn't answer in time. The fallback is the
 * same code, so the answer never depends on where it ran.
 */
import {
  runRouteDetection,
  type DetectionResponse,
  type RouteDetectionInput,
  type RouteDetectionResult,
} from '../utils/routeDetection';

export type RouteDetectionRunner = (input: RouteDetectionInput) => Promise<RouteDetectionResult>;

/** The slice of `Worker` the runner uses. */
export interface DetectionWorker {
  onmessage: ((event: MessageEvent) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  onmessageerror: ((event: MessageEvent) => void) | null;
  postMessage(message: unknown): void;
  terminate(): void;
}

export const runDetectionInline: RouteDetectionRunner = async (input) => runRouteDetection(input);

/** Long past NFR9's 200 ms: a worker this slow is stuck, not busy. */
export const DETECTION_WORKER_TIMEOUT_MS = 15_000;

/* v8 ignore next 4 -- a real module worker; jsdom has none, and the runner's tests inject a fake */
const createModuleWorker = (): DetectionWorker =>
  new Worker(new URL('../workers/routeDetection.worker.ts', import.meta.url), {
    type: 'module',
  }) as DetectionWorker;

interface WorkerRunnerOptions {
  createWorker?: () => DetectionWorker;
  inline?: RouteDetectionRunner;
  timeoutMs?: number;
}

interface Pending {
  resolve: (result: RouteDetectionResult) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export const createWorkerDetectionRunner = ({
  createWorker = createModuleWorker,
  inline = runDetectionInline,
  timeoutMs = DETECTION_WORKER_TIMEOUT_MS,
}: WorkerRunnerOptions = {}): RouteDetectionRunner => {
  let worker: DetectionWorker | null = null;
  let unavailable = false;
  let nextId = 1;
  const pending = new Map<number, Pending>();

  // Once a worker has failed, every later route runs inline: a second worker
  // from the same script would fail the same way.
  const giveUp = (reason: string) => {
    unavailable = true;
    worker?.terminate();
    worker = null;
    const waiting = [...pending.values()];
    pending.clear();
    for (const entry of waiting) {
      clearTimeout(entry.timer);
      entry.reject(new Error(reason));
    }
  };

  const ensureWorker = (): DetectionWorker | null => {
    if (worker || unavailable) return worker;
    try {
      worker = createWorker();
    } catch {
      unavailable = true;
      return null;
    }
    worker.onmessage = ({ data }: MessageEvent<DetectionResponse>) => {
      const entry = pending.get(data.id);
      if (!entry) return;
      pending.delete(data.id);
      clearTimeout(entry.timer);
      if ('result' in data) entry.resolve(data.result);
      else entry.reject(new Error(data.error));
    };
    worker.onerror = () => giveUp('detection worker failed');
    worker.onmessageerror = () => giveUp('detection worker could not read a message');
    return worker;
  };

  const viaWorker = (target: DetectionWorker, input: RouteDetectionInput) =>
    new Promise<RouteDetectionResult>((resolve, reject) => {
      const id = nextId++;
      const timer = setTimeout(() => giveUp('detection worker timed out'), timeoutMs);
      pending.set(id, { resolve, reject, timer });
      try {
        target.postMessage({ id, input });
      } catch (error) {
        // Input structured clone can't copy: this route only, the worker is fine.
        pending.delete(id);
        clearTimeout(timer);
        reject(error as Error);
      }
    });

  return async (input) => {
    const target = ensureWorker();
    if (!target) return inline(input);
    try {
      return await viaWorker(target, input);
    } catch {
      return inline(input);
    }
  };
};
