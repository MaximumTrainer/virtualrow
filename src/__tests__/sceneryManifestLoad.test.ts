import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  loadSceneryManifest,
  resetSceneryManifest,
  orderByCost,
  modelIdFromPath,
  type SceneryManifest,
} from '../utils/sceneryManifest';

/**
 * Issue #332 — the app reading its own manifest.
 *
 * `SceneryModelsChunk` loads a route's models a few at a time, because asking
 * a static host for 58 GLBs at once earned a 503 (#232). Which few go first
 * was the order the selection matrix happened to list them in, so a route
 * could spend its first chunk on the three heaviest models in the kit and show
 * the rower an empty bank while they downloaded.
 */

const manifest: SceneryManifest = {
  totalBytes: 600,
  models: {
    'f45-treeline-strip': { path: 'assets/scenery/tier-f/f45-treeline-strip.glb', bytes: 400, triangles: 9, compressed: true },
    'f01-bank-earth-cut': { path: 'assets/scenery/tier-f/f01-bank-earth-cut.glb', bytes: 100, triangles: 3, compressed: true },
    'e04-english-oak': { path: 'assets/scenery/tier-e/e04-english-oak.glb', bytes: 200, triangles: 5, compressed: true },
  },
};

const pathOf = (id: string) => `/assets/scenery/tier-${id[0]}/${id}.glb`;

beforeEach(() => {
  resetSceneryManifest();
  vi.restoreAllMocks();
});

describe('loading the manifest', () => {
  it('reads it once, however many callers ask', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify(manifest)));

    const [a, b] = await Promise.all([loadSceneryManifest(), loadSceneryManifest()]);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(a).toEqual(manifest);
    expect(b).toBe(a);
  });

  /**
   * The manifest is an optimisation, not a dependency.
   *
   * Without it the models still load in the order the matrix lists them, which
   * is what happened before there was a manifest at all. A row must not fail
   * because a JSON file 404'd.
   */
  it('gives up quietly when it cannot be read', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'));

    await expect(loadSceneryManifest()).resolves.toBeNull();
  });

  it('gives up quietly on a response that is not a manifest', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('<!doctype html>'));

    await expect(loadSceneryManifest()).resolves.toBeNull();
  });

  it('gives up quietly on a 404', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 404 }));

    await expect(loadSceneryManifest()).resolves.toBeNull();
  });
});

describe('ordering a route’s models by what they cost', () => {
  it('puts the cheapest models in the first chunk', () => {
    const paths = ['f45-treeline-strip', 'e04-english-oak', 'f01-bank-earth-cut'].map(pathOf);

    expect(orderByCost(paths, manifest).map(modelIdFromPath)).toEqual([
      'f01-bank-earth-cut',
      'e04-english-oak',
      'f45-treeline-strip',
    ]);
  });

  // A model the manifest has never heard of is not assumed to be free: it
  // goes last, where a surprise cannot hold up the models whose size is known.
  it('leaves a model it knows nothing about until the end', () => {
    const paths = ['z99-mystery', 'f45-treeline-strip', 'f01-bank-earth-cut'].map(pathOf);

    expect(orderByCost(paths, manifest).map(modelIdFromPath)).toEqual([
      'f01-bank-earth-cut',
      'f45-treeline-strip',
      'z99-mystery',
    ]);
  });

  it('keeps the matrix’s own order when there is no manifest', () => {
    const paths = ['f45-treeline-strip', 'f01-bank-earth-cut'].map(pathOf);

    expect(orderByCost(paths, null)).toEqual(paths);
  });

  // Two models of the same size must not swap places between renders: the
  // chunk boundary would move under a model that had already loaded.
  it('is stable for models that weigh the same', () => {
    const same: SceneryManifest = {
      totalBytes: 200,
      models: {
        a: { path: 'a.glb', bytes: 100, triangles: 1, compressed: true },
        b: { path: 'b.glb', bytes: 100, triangles: 1, compressed: true },
      },
    };
    const paths = ['/assets/scenery/tier-b/b.glb', '/assets/scenery/tier-a/a.glb'];

    expect(orderByCost(paths, same)).toEqual(paths);
  });

  it('reads an id back out of the URL it was built into', () => {
    expect(modelIdFromPath('/virtualrow/app/assets/scenery/tier-f/f01-bank-earth-cut.glb')).toBe(
      'f01-bank-earth-cut',
    );
  });
});
