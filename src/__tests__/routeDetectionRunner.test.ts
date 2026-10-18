import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { Coordinate } from '../types/index';
import type { OverpassElement } from '../services/routeEnrichmentService';
import { buildLandAreas, landAt } from '../utils/bankLand';
import { buildWaterMask, type MaskBounds } from '../utils/osmWaterMask';
import { detectRoute } from '../utils/shoreDetection';
import { classifyDetectedRoute } from '../utils/waterClassification';
import {
  answerDetectionRequest,
  runRouteDetection,
  type RouteDetectionInput,
} from '../utils/routeDetection';
import {
  createWorkerDetectionRunner,
  runDetectionInline,
  type DetectionWorker,
} from '../services/routeDetectionRunner';

/**
 * #493 D23 b: detection moves to a Web Worker, with the same work run inline
 * wherever a worker can't be made or dies.
 */
interface OsmFixture {
  route: Coordinate[];
  bounds: MaskBounds;
  elements: OverpassElement[];
}

const fixture = JSON.parse(
  readFileSync(join(process.cwd(), 'src/__tests__/fixtures/osm/61.json'), 'utf8'),
) as OsmFixture;

const input: RouteDetectionInput = {
  coordinates: fixture.route,
  elements: fixture.elements,
  coastlineBounds: fixture.bounds,
};

/** A worker that answers in a later task, through a structured clone, as a real one does. */
class FakeWorker implements DetectionWorker {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: ((event: MessageEvent) => void) | null = null;
  readonly posted: unknown[] = [];
  terminated = false;
  private readonly behaviour: 'answer' | 'crash' | 'silent';
  constructor(behaviour: 'answer' | 'crash' | 'silent' = 'answer') {
    this.behaviour = behaviour;
  }

  postMessage(message: unknown) {
    this.posted.push(message);
    const copy = structuredClone(message);
    setTimeout(() => {
      if (this.behaviour === 'crash') {
        this.onerror?.(new ErrorEvent('error', { message: 'worker script failed to load' }));
        return;
      }
      if (this.behaviour === 'silent') return;
      this.onmessage?.(new MessageEvent('message', { data: structuredClone(answerDetectionRequest(copy)) }));
    }, 0);
  }

  terminate() {
    this.terminated = true;
  }
}

describe('#493 D23 b: route detection off the main thread', () => {
  it('gives the same answer as the steps run one after another', () => {
    const mask = buildWaterMask(fixture.elements, { coastlineBounds: fixture.bounds });
    const land = buildLandAreas(fixture.elements);
    const detection = detectRoute(fixture.route, mask, { landAt: (point) => landAt(land, point) });

    const result = runRouteDetection(input);

    expect(result.samples).toEqual(detection.samples);
    expect(result.summary).toEqual(detection.summary);
    expect(result.detected).toEqual(classifyDetectedRoute(detection.samples, mask, fixture.elements));
  });

  it('answers a request with its id, and an unreadable one with an error', () => {
    expect(answerDetectionRequest({ id: 7, input })).toEqual({ id: 7, result: runRouteDetection(input) });
    expect(answerDetectionRequest({ id: 8, input: { coordinates: null } })).toMatchObject({
      id: 8,
      error: expect.any(String),
    });
    expect(answerDetectionRequest('not a request')).toEqual({ id: -1, error: 'malformed detection request' });
  });

  it('runs inline to the same result', async () => {
    await expect(runDetectionInline(input)).resolves.toEqual(runRouteDetection(input));
  });

  it('sends the work to a worker and resolves with its structured-clone answer', async () => {
    const worker = new FakeWorker();
    const inline = vi.fn(runDetectionInline);
    const run = createWorkerDetectionRunner({ createWorker: () => worker, inline });

    const shorter = { ...input, coordinates: input.coordinates.slice(0, 2) };
    const [first, second] = await Promise.all([run(input), run(shorter)]);

    expect(first).toEqual(runRouteDetection(input));
    expect(second).toEqual(runRouteDetection(shorter));
    expect(second.samples.length).toBeLessThan(first.samples.length);
    expect(worker.posted).toHaveLength(2);
    expect(inline).not.toHaveBeenCalled();
  });

  it('makes one worker and keeps it for later routes', async () => {
    const createWorker = vi.fn(() => new FakeWorker());
    const run = createWorkerDetectionRunner({ createWorker });

    await run(input);
    await run(input);

    expect(createWorker).toHaveBeenCalledTimes(1);
  });

  it('runs inline when no worker can be made', async () => {
    const inline = vi.fn(runDetectionInline);
    const run = createWorkerDetectionRunner({
      createWorker: () => {
        throw new Error('Worker is not defined');
      },
      inline,
    });

    await expect(run(input)).resolves.toEqual(runRouteDetection(input));
    await run(input);
    expect(inline).toHaveBeenCalledTimes(2);
  });

  it('runs inline when the worker dies, and stops using it', async () => {
    const worker = new FakeWorker('crash');
    const createWorker = vi.fn(() => worker);
    const inline = vi.fn(runDetectionInline);
    const run = createWorkerDetectionRunner({ createWorker, inline });

    await expect(run(input)).resolves.toEqual(runRouteDetection(input));
    await run(input);

    expect(worker.terminated).toBe(true);
    expect(createWorker).toHaveBeenCalledTimes(1);
    expect(inline).toHaveBeenCalledTimes(2);
  });

  it('runs inline when the worker answers with an error', async () => {
    const worker = new FakeWorker();
    const inline = vi.fn(runDetectionInline);
    const run = createWorkerDetectionRunner({ createWorker: () => worker, inline });
    const bad = { ...input, coordinates: null } as unknown as RouteDetectionInput;

    await expect(run(bad)).rejects.toThrow();
    expect(inline).toHaveBeenCalledTimes(1);
  });

  it('runs inline when the worker cannot read the message', async () => {
    const worker = new FakeWorker('silent');
    const inline = vi.fn(runDetectionInline);
    const run = createWorkerDetectionRunner({ createWorker: () => worker, inline });

    const pending = run(input);
    worker.onmessageerror?.(new MessageEvent('messageerror'));

    await expect(pending).resolves.toEqual(runRouteDetection(input));
    expect(inline).toHaveBeenCalledTimes(1);
  });

  it('runs one route inline when its input cannot be cloned, and keeps the worker', async () => {
    const worker = new FakeWorker();
    const createWorker = vi.fn(() => worker);
    const inline = vi.fn(runDetectionInline);
    const run = createWorkerDetectionRunner({ createWorker, inline });
    const post = worker.postMessage.bind(worker);
    worker.postMessage = vi.fn(() => {
      throw new DOMException('could not be cloned', 'DataCloneError');
    });

    await expect(run(input)).resolves.toEqual(runRouteDetection(input));
    worker.postMessage = post;
    await run(input);

    expect(inline).toHaveBeenCalledTimes(1);
    expect(worker.terminated).toBe(false);
  });

  it('ignores an answer for a request it never sent', async () => {
    const worker = new FakeWorker('silent');
    const run = createWorkerDetectionRunner({ createWorker: () => worker });

    const pending = run(input);
    worker.onmessage?.(new MessageEvent('message', { data: { id: 999, result: null } }));
    worker.onmessage?.(new MessageEvent('message', { data: answerDetectionRequest({ id: 1, input }) }));

    await expect(pending).resolves.toEqual(runRouteDetection(input));
  });

  it('runs inline when the worker takes too long, and stops using it', async () => {
    vi.useFakeTimers();
    try {
      const worker = new FakeWorker('silent');
      const inline = vi.fn(runDetectionInline);
      const run = createWorkerDetectionRunner({ createWorker: () => worker, inline, timeoutMs: 1000 });

      const pending = run(input);
      await vi.advanceTimersByTimeAsync(1000);

      await expect(pending).resolves.toEqual(runRouteDetection(input));
      expect(worker.terminated).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
