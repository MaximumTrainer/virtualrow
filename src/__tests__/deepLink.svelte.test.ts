import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  RownativeDeepLinkRunner,
  resetDeepLinkForTests,
} from '../lib/ui/deepLink.svelte';
import type { Services } from '../lib/ports';
import type { WaterRoute } from '../lib/types/index';

const route = (id = 'r1') => ({ id, name: `Route ${id}` }) as unknown as WaterRoute;

function services(over: {
  findRouteByRownativeId?: (id: string) => WaterRoute | undefined;
  importCourseById?: (id: string) => Promise<WaterRoute>;
} = {}): Services {
  return {
    routeService: { findRouteByRownativeId: over.findRouteByRownativeId ?? (() => undefined) },
    rownativeService: {
      importCourseById: over.importCourseById ?? (async () => route()),
    },
  } as unknown as Services;
}

function setUrl(search: string) {
  window.history.replaceState({}, '', `/app/${search}`);
}

// #542 P1: the rownative deep-link runner ported from useRownativeDeepLink.
describe('RownativeDeepLinkRunner', () => {
  beforeEach(() => {
    resetDeepLinkForTests();
    setUrl('');
  });

  it('is idle and does nothing with no course id in the URL', async () => {
    const importCourseById = vi.fn(async () => route());
    const runner = new RownativeDeepLinkRunner(services({ importCourseById }));
    expect(runner.status.kind).toBe('idle');
    const onLoaded = vi.fn();
    runner.run(true, onLoaded);
    await Promise.resolve();
    expect(importCourseById).not.toHaveBeenCalled();
    expect(onLoaded).not.toHaveBeenCalled();
  });

  it('strips the course id (and legacy state) from the URL on construction', () => {
    setUrl('?rownativeCourseId=5&state=abc&foo=bar');
    const runner = new RownativeDeepLinkRunner(services());
    expect(runner.status).toEqual({ kind: 'loading', courseId: '5' });
    expect(window.location.search).toBe('?foo=bar');
  });

  it('selects an already-imported course without a fresh import', async () => {
    setUrl('?rownativeCourseId=7');
    const importCourseById = vi.fn(async () => route('fresh'));
    const existing = route('existing');
    const runner = new RownativeDeepLinkRunner(
      services({ findRouteByRownativeId: () => existing, importCourseById }),
    );
    const onLoaded = vi.fn();
    runner.run(true, onLoaded);
    await vi.waitFor(() => expect(runner.status.kind).toBe('loaded'));
    expect(importCourseById).not.toHaveBeenCalled();
    expect(onLoaded).toHaveBeenCalledWith(existing);
  });

  it('imports a fresh course and loads it once ready', async () => {
    setUrl('?rownativeCourseId=9');
    const imported = route('imported');
    const importCourseById = vi.fn(async () => imported);
    const runner = new RownativeDeepLinkRunner(services({ importCourseById }));
    const onLoaded = vi.fn();

    // Held while not ready.
    runner.run(false, onLoaded);
    await Promise.resolve();
    expect(importCourseById).not.toHaveBeenCalled();

    runner.run(true, onLoaded);
    await vi.waitFor(() => expect(runner.status).toEqual({ kind: 'loaded', route: imported }));
    expect(onLoaded).toHaveBeenCalledWith(imported);

    // Idempotent: a second ready call does not import again.
    runner.run(true, onLoaded);
    expect(importCourseById).toHaveBeenCalledTimes(1);
  });

  it('reports an error when the import fails', async () => {
    setUrl('?rownativeCourseId=11');
    const runner = new RownativeDeepLinkRunner(
      services({ importCourseById: async () => { throw new Error('boom'); } }),
    );
    runner.run(true, vi.fn());
    await vi.waitFor(() => expect(runner.status.kind).toBe('error'));
    expect(runner.status).toEqual({ kind: 'error', courseId: '11', message: 'boom' });

    runner.dismiss();
    expect(runner.status.kind).toBe('idle');
  });

  it('strips to a bare path when the course id was the only parameter', () => {
    setUrl('?rownativeCourseId=5');
    const runner = new RownativeDeepLinkRunner(services());
    expect(runner.status).toEqual({ kind: 'loading', courseId: '5' });
    expect(window.location.search).toBe('');
  });

  it('falls back to a generic message when the import rejects with a non-Error', async () => {
    setUrl('?rownativeCourseId=13');
    const runner = new RownativeDeepLinkRunner(
      services({ importCourseById: async () => { throw 'nope'; } }),
    );
    runner.run(true, vi.fn());
    await vi.waitFor(() => expect(runner.status.kind).toBe('error'));
    expect(runner.status).toEqual({
      kind: 'error',
      courseId: '13',
      message: 'Could not load rownative course 13.',
    });
  });
});
