import { describe, it, expect, vi, beforeEach } from 'vitest';
import { flushSync } from 'svelte';

import { RoutesStore } from '../lib/ui/routesStore.svelte';
import type { Services } from '../lib/ports';
import type { WaterRoute } from '../lib/types/index';

function route(id: string, over: Partial<WaterRoute> = {}): WaterRoute {
  return {
    id,
    name: `Route ${id}`,
    location: 'Somewhere',
    distance: 5,
    estimatedTime: 20,
    difficulty: 'moderate',
    coordinates: [],
    ...over,
  } as unknown as WaterRoute;
}

/** A services bundle with only the catalogue ports the store touches. */
function stubServices(routes: WaterRoute[]): Services {
  return {
    routeService: {
      getAllRoutes: vi.fn(() => routes),
      getRouteById: vi.fn((id: string) => routes.find((r) => r.id === id)),
      importRouteFromGPX: vi.fn(),
      importRouteFromKML: vi.fn(),
      importRouteFromGeoJSON: vi.fn(),
      finalizeKMLImport: vi.fn(),
    },
    routeEnrichmentService: {
      readCached: vi.fn(() => ({ data: null, stale: false })),
      enrichRoute: vi.fn(async () => ({}) as never),
    },
    defaultRoutePreferenceStore: {
      resolveDefaultRouteId: vi.fn(() => null),
      setDefaultRouteId: vi.fn(),
      clearDefaultRouteId: vi.fn(),
    },
  } as unknown as Services;
}

// #542 P1 Routes screen: the catalogue store ported from App.tsx state.
describe('RoutesStore', () => {
  let cleanup: (() => void) | undefined;
  beforeEach(() => {
    cleanup?.();
  });

  it('loads routes and derives the difficulty filter and dimmed set', () => {
    const data = [
      route('1', { difficulty: 'easy' }),
      route('2', { difficulty: 'hard' }),
      route('3', { difficulty: 'easy' }),
    ];
    const store = new RoutesStore(stubServices(data));

    // $derived fields need an active effect scope to read outside a component.
    const stop = $effect.root(() => {
      store.load();
      expect(store.routes).toHaveLength(3);

      store.difficultyFilter = 'easy';
      flushSync();
      expect(store.filteredRoutes.map((r) => r.id)).toEqual(['1', '3']);
      // The two easy routes are kept; the hard one is dimmed on the map.
      expect([...store.dimmedRouteIds]).toEqual(['2']);
    });
    cleanup = stop;
  });

  it('stars and un-stars a default route for the signed-in athlete', () => {
    const services = stubServices([route('1'), route('2')]);
    const store = new RoutesStore(services);
    store.load();

    store.toggleDefaultRoute('user-1', '2');
    expect(services.defaultRoutePreferenceStore.setDefaultRouteId).toHaveBeenCalledWith('user-1', '2');
    expect(store.defaultRouteId).toBe('2');

    store.toggleDefaultRoute('user-1', '2');
    expect(services.defaultRoutePreferenceStore.clearDefaultRouteId).toHaveBeenCalledWith('user-1');
    expect(store.defaultRouteId).toBeNull();

    // A guest (no id) cannot set a default.
    store.toggleDefaultRoute(null, '1');
    expect(store.defaultRouteId).toBeNull();
  });

  it('selecting a route enriches it and marks it loading until done', async () => {
    const services = stubServices([route('1')]);
    let resolveEnrich: (v: unknown) => void = () => {};
    (services.routeEnrichmentService.enrichRoute as ReturnType<typeof vi.fn>).mockReturnValue(
      new Promise((res) => {
        resolveEnrich = res;
      }),
    );
    const store = new RoutesStore(services);
    store.load();

    const stop = $effect.root(() => {
      store.selectRoute(route('1'));
      flushSync();
      expect(store.selectedRoute?.id).toBe('1');
      expect(store.routeEnrichmentLoading['1']).toBe(true);
    });
    cleanup = stop;

    resolveEnrich({ lakes: [] });
    await Promise.resolve();
    await Promise.resolve();
    expect(store.routeEnrichmentLoading['1']).toBe(false);
  });
});
