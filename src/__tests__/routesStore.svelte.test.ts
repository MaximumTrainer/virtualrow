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

// #542 P1: importFile dispatches on the file type (App.tsx handleRouteFileImport,
// #194 F7). The Routes screen's file-import panel and the Row screen both rely on
// it, so the branch coverage lives here rather than only in an e2e spec.
describe('RoutesStore.importFile', () => {
  const file = (name: string, text = '{}') =>
    new File([text], name, { type: 'application/octet-stream' });

  it('rejects an unreadable file type with an error and no route', async () => {
    const store = new RoutesStore(stubServices([route('1')]));
    const imported = await store.importFile(file('track.txt'));
    expect(imported).toBeNull();
    expect(store.importError).toMatch(/not a route file/);
  });

  it('imports a GPX file, selects it and closes the panel', async () => {
    const services = stubServices([route('1')]);
    const made = route('gpx-1', { name: 'From GPX' });
    (services.routeService.importRouteFromGPX as ReturnType<typeof vi.fn>).mockReturnValue(made);
    const store = new RoutesStore(services);
    store.isImportOpen = true;

    const imported = await store.importFile(file('ride.gpx', '<gpx/>'));
    expect(imported?.id).toBe('gpx-1');
    expect(store.selectedRoute?.id).toBe('gpx-1');
    expect(store.isImportOpen).toBe(false);
    expect(store.importError).toBeNull();
  });

  it('finalizes a KML import that needs a track picked', async () => {
    const services = stubServices([route('1')]);
    const candidate = { name: 'Track A' };
    const made = route('kml-1');
    (services.routeService.importRouteFromKML as ReturnType<typeof vi.fn>).mockReturnValue({
      status: 'selectionRequired',
      candidates: [candidate],
    });
    (services.routeService.finalizeKMLImport as ReturnType<typeof vi.fn>).mockReturnValue(made);
    const store = new RoutesStore(services);

    const imported = await store.importFile(file('route.kml', '<kml/>'));
    expect(imported?.id).toBe('kml-1');
    expect(services.routeService.finalizeKMLImport).toHaveBeenCalledWith(
      candidate,
      expect.objectContaining({ difficulty: 'moderate' }),
    );
  });

  it('surfaces a KML parse error', async () => {
    const services = stubServices([route('1')]);
    (services.routeService.importRouteFromKML as ReturnType<typeof vi.fn>).mockReturnValue({
      status: 'error',
      error: 'bad kml',
    });
    const store = new RoutesStore(services);

    const imported = await store.importFile(file('route.kml', '<kml/>'));
    expect(imported).toBeNull();
    expect(store.importError).toBe('bad kml');
  });

  it('imports a GeoJSON file, taking its name from the properties', async () => {
    const services = stubServices([route('1')]);
    const made = route('geo-1');
    (services.routeService.importRouteFromGeoJSON as ReturnType<typeof vi.fn>).mockReturnValue(made);
    const store = new RoutesStore(services);

    const imported = await store.importFile(
      file('shape.geojson', '{"properties":{"name":"Lake","country":"NZ"}}'),
    );
    expect(imported?.id).toBe('geo-1');
    expect(services.routeService.importRouteFromGeoJSON).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ name: 'Lake', location: 'NZ' }),
    );
  });

  it('errors when the parser finds no usable route line', async () => {
    const services = stubServices([route('1')]);
    (services.routeService.importRouteFromGPX as ReturnType<typeof vi.fn>).mockReturnValue(undefined);
    const store = new RoutesStore(services);

    const imported = await store.importFile(file('empty.gpx', '<gpx/>'));
    expect(imported).toBeNull();
    expect(store.importError).toMatch(/no route line/);
  });

  it('passes the typed-in name to a KML import', async () => {
    const services = stubServices([route('1')]);
    (services.routeService.importRouteFromKML as ReturnType<typeof vi.fn>).mockReturnValue({
      status: 'ok',
      route: route('kml-named'),
    });
    const store = new RoutesStore(services);
    store.importRouteName = '  My Lake  ';

    await store.importFile(file('route.kml', '<kml/>'));
    expect(services.routeService.importRouteFromKML).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ name: 'My Lake' }),
    );
  });

  it('falls back to the file name and Imported location for a GeoJSON with no properties', async () => {
    const services = stubServices([route('1')]);
    (services.routeService.importRouteFromGeoJSON as ReturnType<typeof vi.fn>).mockReturnValue(route('g'));
    const store = new RoutesStore(services);

    await store.importFile(file('bay.geojson', '{"type":"FeatureCollection"}'));
    expect(services.routeService.importRouteFromGeoJSON).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ name: 'bay', location: 'Imported' }),
    );
  });

  it('reports a generic error when the parser throws a non-Error', async () => {
    const services = stubServices([route('1')]);
    (services.routeService.importRouteFromGPX as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw 'kaboom';
    });
    const store = new RoutesStore(services);

    const imported = await store.importFile(file('x.gpx', '<gpx/>'));
    expect(imported).toBeNull();
    expect(store.importError).toMatch(/could not be imported/);
  });
});

// #542 P1: selecting a route brings its enrichment in from the cache, fetching
// only when the cache is empty or stale (App.tsx's enrichment effect).
describe('RoutesStore enrichment on select', () => {
  it('uses fresh cached enrichment without fetching', () => {
    const services = stubServices([route('1')]);
    (services.routeEnrichmentService.readCached as ReturnType<typeof vi.fn>).mockReturnValue({
      data: { lakes: [] },
      stale: false,
    });
    const store = new RoutesStore(services);
    store.load();
    const stop = $effect.root(() => {
      store.selectRoute(route('1'));
      flushSync();
      expect(store.routeEnrichmentLoading['1']).toBe(false);
    });
    stop();
    expect(services.routeEnrichmentService.enrichRoute).not.toHaveBeenCalled();
  });

  it('refreshes stale cached enrichment in the background', () => {
    const services = stubServices([route('1')]);
    (services.routeEnrichmentService.readCached as ReturnType<typeof vi.fn>).mockReturnValue({
      data: { lakes: [] },
      stale: true,
    });
    const store = new RoutesStore(services);
    store.load();
    const stop = $effect.root(() => {
      store.selectRoute(route('1'));
      flushSync();
    });
    stop();
    expect(services.routeEnrichmentService.enrichRoute).toHaveBeenCalled();
  });
});
