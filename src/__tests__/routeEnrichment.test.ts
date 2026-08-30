import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WaterRoute } from '../types/index';
import {
  OPEN_TOPO_DATA_URL,
  OVERPASS_API_URL,
  ROUTE_ENRICHMENT_CACHE_TTL_MS,
  MAX_TERRAIN_RELIEF_SCENE_UNITS,
  RouteEnrichmentService,
  TERRAIN_RELIEF_SCALE,
  buildOverpassQuery,
  buildTerrainProfile,
  calculateBearingDeltaForSegments,
  createFallbackRouteEnrichment,
  getRouteEnrichmentCacheKey,
  loadCachedRouteEnrichment,
  mapOsmTagsToSceneryProfile,
  getTerrainReliefForProgress,
  normalizeElevations,
  saveCachedRouteEnrichment,
  splitCoordinatesIntoElevationBatches,
  type OverpassElement,
  type RouteEnrichmentData,
} from '../services/routeEnrichmentService';

const routeFixture: WaterRoute = {
  id: 'route-1',
  name: 'Test Canal',
  description: 'Test route',
  distance: 2,
  difficulty: 'moderate',
  location: 'Somewhere',
  coordinates: [
    { lat: 51.5, lng: -0.11 },
    { lat: 51.5005, lng: -0.1097 },
    { lat: 51.501, lng: -0.1091 },
    { lat: 51.5014, lng: -0.1084 },
  ],
  elevationGain: 0,
  estimatedTime: 20,
  tags: ['canal'],
  createdAt: new Date('2025-01-01T00:00:00Z'),
};

const routeWithoutWaterTags: WaterRoute = {
  ...routeFixture,
  id: 'route-2',
  tags: [],
};

const FIXTURE_BOUNDS = {
  minlat: 51.499,
  minlon: -0.112,
  maxlat: 51.503,
  maxlon: -0.107,
};

/** A forest bank and a 14 m canal, both covering the whole fixture route. */
const DEFAULT_OVERPASS_ELEMENTS: OverpassElement[] = [
  { type: 'way', tags: { landuse: 'forest' }, bounds: FIXTURE_BOUNDS },
  { type: 'way', tags: { waterway: 'canal', width: '14' }, bounds: FIXTURE_BOUNDS },
];

interface FetchStubOptions {
  /**
   * Elevation for the n-th coordinate of the whole route (`null` models an
   * OpenTopoData no-data cell). `index` is route-global, not batch-local.
   */
  elevationFor?: (index: number, location: string) => number | null;
  /** Force the `results` length per batch — used to model a short/long payload. */
  elevationResultCount?: number;
  elements?: OverpassElement[];
  elevationStatus?: number;
  overpassStatus?: number;
  /** Keeps a request pending so concurrent callers genuinely overlap. */
  delayMs?: number;
}

/**
 * Fetch double for `RouteEnrichmentService`.
 *
 * Dispatch is keyed on the request **URL**, never on invocation order: the
 * service issues its two upstream calls inside a `Promise.all` and splits
 * elevations into batches, so an order-keyed double (`mockResolvedValueOnce`
 * twice) silently feeds the Overpass body into the elevation parser as soon as
 * either of those details changes. Counts are exposed per upstream for the
 * same reason.
 */
const createFetchStub = (options: FetchStubOptions = {}) => {
  const {
    elevationFor = (index) => 5 + index,
    elevationResultCount,
    elements = DEFAULT_OVERPASS_ELEMENTS,
    elevationStatus = 200,
    overpassStatus = 200,
    delayMs = 0,
  } = options;

  const elevationRequests: string[] = [];
  const overpassRequests: RequestInit[] = [];
  let nextElevationIndex = 0;

  const respond = (status: number, body: unknown) =>
    ({
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    }) as Response;

  const fetchStub = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = String(input);
      if (delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }

      if (url.startsWith(OPEN_TOPO_DATA_URL)) {
        elevationRequests.push(url);
        if (elevationStatus < 200 || elevationStatus >= 300) {
          return respond(elevationStatus, { error: 'Too Many Requests' });
        }
        const locations = (new URL(url).searchParams.get('locations') ?? '')
          .split('|')
          .filter(Boolean);
        const offset = nextElevationIndex;
        nextElevationIndex += locations.length;
        return respond(200, {
          results: Array.from(
            { length: elevationResultCount ?? locations.length },
            (_, position) => ({
              elevation: elevationFor(offset + position, locations[position] ?? ''),
            }),
          ),
        });
      }

      if (url === OVERPASS_API_URL) {
        overpassRequests.push(init ?? {});
        if (overpassStatus < 200 || overpassStatus >= 300) {
          return respond(overpassStatus, { error: 'Gateway Timeout' });
        }
        return respond(200, { elements });
      }

      throw new Error(`Unexpected request URL: ${url}`);
    },
  );

  return {
    fetch: fetchStub as unknown as typeof fetch,
    elevationCalls: () => [...elevationRequests],
    overpassCalls: () => [...overpassRequests],
  };
};

/** Write `data` to the cache and back-date it past the TTL. */
const seedStaleCacheEntry = (routeId: string, data: RouteEnrichmentData) => {
  saveCachedRouteEnrichment(routeId, data, localStorage);
  const key = getRouteEnrichmentCacheKey(routeId);
  const raw = JSON.parse(localStorage.getItem(key) ?? '{}');
  raw.savedAt = Date.now() - ROUTE_ENRICHMENT_CACHE_TTL_MS - 1000;
  localStorage.setItem(key, JSON.stringify(raw));
};

describe('route enrichment helpers', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('maps OSM tags to scenery profiles', () => {
    expect(mapOsmTagsToSceneryProfile({ landuse: 'forest' })).toBe('forest');
    expect(mapOsmTagsToSceneryProfile({ landuse: 'farmland' })).toBe('farmland');
    expect(mapOsmTagsToSceneryProfile({ natural: 'wetland' })).toBe('wetland');
    expect(mapOsmTagsToSceneryProfile({ building: 'yes' })).toBe('commercial');
    expect(mapOsmTagsToSceneryProfile({})).toBe('fallback');
  });

  it('splits elevation requests into batches of 100 points', () => {
    const coordinates = Array.from({ length: 205 }, (_, index) => ({
      lat: 51 + index * 0.0001,
      lng: -0.1,
    }));

    const batches = splitCoordinatesIntoElevationBatches(coordinates);

    expect(batches).toHaveLength(3);
    expect(batches[0]).toHaveLength(100);
    expect(batches[1]).toHaveLength(100);
    expect(batches[2]).toHaveLength(5);
  });

  it('calculates bearing deltas between consecutive segments', () => {
    expect(calculateBearingDeltaForSegments([10, 12, 45, 355])).toEqual([
      0,
      2,
      33,
      50,
    ]);
  });

  it('normalises elevation payloads to one value per coordinate', () => {
    // Exact length is passed through untouched.
    expect(normalizeElevations([1, 2, 3], 3)).toEqual([1, 2, 3]);
    // Short payloads pad with the last known value…
    expect(normalizeElevations([1, 2], 4)).toEqual([1, 2, 2, 2]);
    // …and with 0 when there is no last known value.
    expect(normalizeElevations([], 2)).toEqual([0, 0]);
    // Long payloads are truncated to the coordinate count.
    expect(normalizeElevations([1, 2, 3, 4], 2)).toEqual([1, 2]);
    // null / non-finite entries become 0 without shifting later values.
    expect(normalizeElevations([Number.NaN, null, 7], 3)).toEqual([0, 0, 7]);
    expect(normalizeElevations([undefined, Number.POSITIVE_INFINITY], 2)).toEqual([0, 0]);
  });

  it('reads fresh and stale cache entries correctly', () => {
    const cached = createFallbackRouteEnrichment(routeFixture);
    saveCachedRouteEnrichment(routeFixture.id, cached, localStorage);

    expect(loadCachedRouteEnrichment(routeFixture.id, localStorage)).toMatchObject({
      stale: false,
      data: expect.objectContaining({ routeId: routeFixture.id }),
    });

    const key = getRouteEnrichmentCacheKey(routeFixture.id);
    const raw = JSON.parse(localStorage.getItem(key) ?? '{}');
    raw.savedAt = Date.now() - ROUTE_ENRICHMENT_CACHE_TTL_MS - 1000;
    localStorage.setItem(key, JSON.stringify(raw));

    expect(loadCachedRouteEnrichment(routeFixture.id, localStorage).stale).toBe(true);
  });

  it('treats corrupt or malformed cache entries as a miss', () => {
    const miss = { data: null, stale: false };
    const key = getRouteEnrichmentCacheKey(routeFixture.id);

    // Nothing stored at all.
    expect(loadCachedRouteEnrichment(routeFixture.id, localStorage)).toEqual(miss);

    // Unparseable JSON.
    localStorage.setItem(key, '{not json');
    expect(loadCachedRouteEnrichment(routeFixture.id, localStorage)).toEqual(miss);

    // Parseable, but no `data`.
    localStorage.setItem(key, JSON.stringify({ savedAt: Date.now() }));
    expect(loadCachedRouteEnrichment(routeFixture.id, localStorage)).toEqual(miss);

    // Parseable, but `savedAt` is not a number, so staleness is unknowable.
    localStorage.setItem(
      key,
      JSON.stringify({
        savedAt: '2025-01-01',
        data: createFallbackRouteEnrichment(routeFixture),
      }),
    );
    expect(loadCachedRouteEnrichment(routeFixture.id, localStorage)).toEqual(miss);

    // No storage at all (SSR / privacy mode).
    expect(loadCachedRouteEnrichment(routeFixture.id, null)).toEqual(miss);
  });

  it('builds an Overpass query with the expected tag filters', () => {
    const query = buildOverpassQuery(routeFixture.coordinates);

    expect(query).toContain('way["landuse"]');
    expect(query).toContain('way["waterway"]');
    expect(query).toContain('relation["building"]');
    expect(query).toContain('node["natural"]');
  });
});

describe('terrain relief (#202)', () => {
  it('returns a flat profile when there is no elevation data', () => {
    expect(buildTerrainProfile(undefined).relief).toEqual([]);
    expect(buildTerrainProfile([]).relief).toEqual([]);
    expect(buildTerrainProfile([Number.NaN, Number.POSITIVE_INFINITY]).relief).toEqual([]);
  });

  it('returns a flat profile for genuinely flat water, so the scene is unchanged', () => {
    // createFallbackRouteEnrichment fills elevations with zeros. That has to
    // render exactly as it did before elevations were consumed.
    const profile = buildTerrainProfile([0, 0, 0, 0]);

    expect(profile.relief).toEqual([]);
    expect(profile.rangeMeters).toBe(0);
    expect(getTerrainReliefForProgress(profile, 0.5)).toBe(0);
  });

  it('anchors relief to the route minimum rather than sea level', () => {
    // A course at 1,500 m is not 1,500 units up in the air; only its own
    // 40 m of internal relief is drawn.
    const profile = buildTerrainProfile([1500, 1520, 1540]);

    expect(profile.rangeMeters).toBe(40);
    expect(profile.relief[0]).toBe(0);
    expect(profile.relief[2]).toBeCloseTo(40 * TERRAIN_RELIEF_SCALE, 6);
  });

  it('clamps relief so an alpine course stays rowable', () => {
    const profile = buildTerrainProfile([0, 100000]);

    expect(profile.relief[1]).toBe(MAX_TERRAIN_RELIEF_SCENE_UNITS);
  });

  it('treats a non-finite sample as ground level instead of poisoning the mesh', () => {
    const profile = buildTerrainProfile([0, Number.NaN, 100]);

    expect(profile.relief.every((value) => Number.isFinite(value))).toBe(true);
    expect(profile.relief[1]).toBe(0);
  });

  it('interpolates between samples along the route', () => {
    const profile = buildTerrainProfile([0, 100]);

    expect(getTerrainReliefForProgress(profile, 0)).toBeCloseTo(0, 6);
    expect(getTerrainReliefForProgress(profile, 1)).toBeCloseTo(100 * TERRAIN_RELIEF_SCALE, 6);
    expect(getTerrainReliefForProgress(profile, 0.5)).toBeCloseTo(50 * TERRAIN_RELIEF_SCALE, 6);
  });

  it('clamps progress and survives a non-finite one', () => {
    const profile = buildTerrainProfile([0, 100]);

    expect(getTerrainReliefForProgress(profile, -3)).toBe(0);
    expect(getTerrainReliefForProgress(profile, 4)).toBeCloseTo(100 * TERRAIN_RELIEF_SCALE, 6);
    expect(getTerrainReliefForProgress(profile, Number.NaN)).toBe(0);
  });

  it('never returns a non-finite height, whatever the input', () => {
    const profile = buildTerrainProfile([10, Number.NaN, 30, 20]);

    for (let t = 0; t <= 1; t += 0.05) {
      expect(Number.isFinite(getTerrainReliefForProgress(profile, t))).toBe(true);
    }
  });

  it('produces plausible relief for realistic waterway profiles (#214 A4)', () => {
    // Cam (flat): ~8 m drop over 5 km — should be barely perceptible
    const cam = buildTerrainProfile([12, 10, 8, 6, 4]);
    expect(cam.rangeMeters).toBe(8);
    expect(Math.max(...cam.relief)).toBeCloseTo(8 * TERRAIN_RELIEF_SCALE, 6);
    expect(Math.max(...cam.relief)).toBeLessThan(1);

    // Danube gorge: ~290 m range — should be dramatic but under the cap
    const danube = buildTerrainProfile([60, 120, 200, 290, 350]);
    expect(danube.rangeMeters).toBe(290);
    expect(Math.max(...danube.relief)).toBeCloseTo(290 * TERRAIN_RELIEF_SCALE, 6);
    expect(Math.max(...danube.relief)).toBeLessThan(MAX_TERRAIN_RELIEF_SCENE_UNITS);
  });
});

describe('RouteEnrichmentService', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('fetches enrichment data, caches it, and reuses the cache on subsequent loads', async () => {
    const stub = createFetchStub();
    const service = new RouteEnrichmentService(stub.fetch, localStorage);

    const first = await service.enrichRoute(routeFixture);
    const second = await service.enrichRoute(routeFixture);

    expect(stub.elevationCalls()).toHaveLength(1);
    expect(stub.overpassCalls()).toHaveLength(1);
    expect(stub.overpassCalls()[0].method).toBe('POST');
    expect(first.source).toBe('network');
    expect(first.elevations).toEqual([5, 6, 7, 8]);
    expect(first.waterBodyType).toBe('canal');
    expect(first.segmentProfiles[0].sceneryProfile).toBe('forest');
    expect(first.segmentProfiles[0].waterWidthMeters).toBe(14);
    expect(first.segmentProfiles.length).toBeGreaterThan(0);
    expect(second.source).toBe('cache');
  });

  it('issues one elevation request per 100-point batch and stitches the results', async () => {
    const longRoute: WaterRoute = {
      ...routeFixture,
      id: 'route-long',
      coordinates: Array.from({ length: 205 }, (_, index) => ({
        lat: 51.5 + index * 0.0001,
        lng: -0.11,
      })),
    };
    const stub = createFetchStub({ elements: [] });
    const service = new RouteEnrichmentService(stub.fetch, localStorage);

    const enrichment = await service.enrichRoute(longRoute);

    expect(stub.elevationCalls()).toHaveLength(3);
    expect(stub.overpassCalls()).toHaveLength(1);
    expect(enrichment.source).toBe('network');
    expect(enrichment.elevations).toHaveLength(205);
    // Batch boundaries are stitched in order, not overwritten.
    expect(enrichment.elevations[0]).toBe(5);
    expect(enrichment.elevations[99]).toBe(104);
    expect(enrichment.elevations[100]).toBe(105);
    expect(enrichment.elevations[204]).toBe(209);
  });

  it('constrains an elevation payload whose length does not match the route', async () => {
    const stub = createFetchStub({ elevationResultCount: 1 });
    const service = new RouteEnrichmentService(stub.fetch, localStorage);

    const enrichment = await service.enrichRoute(routeFixture);

    // Overpass scenery is still valid, so a short elevation payload must not
    // degrade the whole result to 'fallback' — it is padded instead.
    expect(enrichment.source).toBe('network');
    expect(enrichment.elevations).toHaveLength(routeFixture.coordinates.length);
    expect(enrichment.elevations).toEqual([5, 5, 5, 5]);
  });

  it('substitutes 0 for null elevations (OpenTopoData no-data cells)', async () => {
    const stub = createFetchStub({
      elevationFor: (index) => (index === 1 ? null : 12),
    });
    const service = new RouteEnrichmentService(stub.fetch, localStorage);

    const enrichment = await service.enrichRoute(routeFixture);

    expect(enrichment.source).toBe('network');
    expect(enrichment.elevations).toEqual([12, 0, 12, 12]);
  });

  it('falls back quietly when the APIs fail', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('network down'));
    const service = new RouteEnrichmentService(
      fetchMock as unknown as typeof fetch,
      localStorage,
    );

    const enrichment = await service.enrichRoute(routeFixture);

    expect(enrichment.source).toBe('fallback');
    // Water body comes from the route's own tags (['canal']).
    expect(enrichment.waterBodyType).toBe('canal');
    expect(enrichment.elevations).toHaveLength(routeFixture.coordinates.length);
    expect(enrichment.segmentProfiles.length).toBeGreaterThan(0);
    // A synthetic fallback must never be persisted as if it were real data.
    expect(localStorage.getItem(getRouteEnrichmentCacheKey(routeFixture.id))).toBeNull();
  });

  it.each([
    ['OpenTopoData', { elevationStatus: 429 }],
    ['Overpass', { overpassStatus: 504 }],
  ] as const)(
    'falls back when the %s API returns a non-2xx status',
    async (_upstream, overrides) => {
      const stub = createFetchStub(overrides);
      const service = new RouteEnrichmentService(stub.fetch, localStorage);

      const enrichment = await service.enrichRoute(routeFixture);

      expect(enrichment.source).toBe('fallback');
      expect(localStorage.getItem(getRouteEnrichmentCacheKey(routeFixture.id))).toBeNull();
    },
  );

  it('prefers stale cached data over the synthetic fallback when a refresh fails', async () => {
    // The tag-derived fallback would say 'canal'; the cached (real) data says
    // 'river'. Losing that on a flaky connection is a visible scenery downgrade.
    expect(createFallbackRouteEnrichment(routeFixture).waterBodyType).toBe('canal');
    seedStaleCacheEntry(routeFixture.id, {
      ...createFallbackRouteEnrichment(routeFixture),
      waterBodyType: 'river',
      waterWidthMeters: 55,
      source: 'network',
    });
    const fetchMock = vi.fn().mockRejectedValue(new Error('network down'));
    const service = new RouteEnrichmentService(
      fetchMock as unknown as typeof fetch,
      localStorage,
    );

    const enrichment = await service.enrichRoute(routeFixture);

    expect(enrichment.source).toBe('cache');
    expect(enrichment.waterBodyType).toBe('river');
    expect(enrichment.waterWidthMeters).toBe(55);
  });

  it('refreshes a stale cache entry from the network', async () => {
    seedStaleCacheEntry(routeFixture.id, {
      ...createFallbackRouteEnrichment(routeFixture),
      waterBodyType: 'river',
      waterWidthMeters: 55,
      source: 'network',
    });
    const stub = createFetchStub();
    const service = new RouteEnrichmentService(stub.fetch, localStorage);

    const enrichment = await service.enrichRoute(routeFixture);

    expect(stub.elevationCalls()).toHaveLength(1);
    expect(stub.overpassCalls()).toHaveLength(1);
    expect(enrichment.source).toBe('network');
    // Network data wins over the stale entry.
    expect(enrichment.waterBodyType).toBe('canal');
    expect(enrichment.segmentProfiles[0].waterWidthMeters).toBe(14);
    expect(service.readCached(routeFixture.id).stale).toBe(false);
  });

  it('deduplicates concurrent requests for the same route', async () => {
    const stub = createFetchStub({ delayMs: 5 });
    const service = new RouteEnrichmentService(stub.fetch, localStorage);

    const [first, second] = await Promise.all([
      service.enrichRoute(routeFixture),
      service.enrichRoute(routeFixture),
    ]);

    expect(second).toBe(first);
    expect(first.source).toBe('network');
    expect(stub.elevationCalls()).toHaveLength(1);
    expect(stub.overpassCalls()).toHaveLength(1);

    const third = await service.enrichRoute(routeFixture);

    expect(third.source).toBe('cache');
    expect(stub.elevationCalls()).toHaveLength(1);
    expect(stub.overpassCalls()).toHaveLength(1);
  });

  it('clears one or all cached routes', async () => {
    localStorage.setItem('virtualrow:unrelated', 'keep me');
    const stub = createFetchStub();
    const service = new RouteEnrichmentService(stub.fetch, localStorage);
    const otherRoute: WaterRoute = { ...routeFixture, id: 'route-3' };

    await service.enrichRoute(routeFixture);
    await service.enrichRoute(otherRoute);

    expect(localStorage.getItem(getRouteEnrichmentCacheKey(routeFixture.id))).not.toBeNull();
    expect(localStorage.getItem(getRouteEnrichmentCacheKey(otherRoute.id))).not.toBeNull();

    service.clearCache(routeFixture.id);

    expect(localStorage.getItem(getRouteEnrichmentCacheKey(routeFixture.id))).toBeNull();
    expect(localStorage.getItem(getRouteEnrichmentCacheKey(otherRoute.id))).not.toBeNull();

    service.clearAllCache();

    expect(localStorage.getItem(getRouteEnrichmentCacheKey(otherRoute.id))).toBeNull();
    expect(localStorage.getItem('virtualrow:unrelated')).toBe('keep me');
  });

  it('does not emit debug logging under test', async () => {
    expect(import.meta.env.MODE).toBe('test');
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const stub = createFetchStub();
    const service = new RouteEnrichmentService(stub.fetch, localStorage);

    const enrichment = await service.enrichRoute(routeFixture);

    expect(enrichment.source).toBe('network');
    expect(debugSpy).not.toHaveBeenCalled();
    expect(logSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('returns fallback immediately for routes without coordinates', async () => {
    const stub = createFetchStub();
    const service = new RouteEnrichmentService(stub.fetch, localStorage);

    const enrichment = await service.enrichRoute({
      ...routeFixture,
      id: 'route-empty',
      coordinates: [],
    });

    expect(stub.elevationCalls()).toHaveLength(0);
    expect(stub.overpassCalls()).toHaveLength(0);
    expect(enrichment.source).toBe('fallback');
    expect(enrichment.elevations).toEqual([]);
  });

  it('returns network enrichment when cache writes fail', async () => {
    const stub = createFetchStub();
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded');
    });
    const service = new RouteEnrichmentService(stub.fetch, localStorage);

    const enrichment = await service.enrichRoute(routeFixture);

    expect(setItem).toHaveBeenCalled();
    expect(enrichment.source).toBe('network');
    expect(enrichment.waterBodyType).toBe('canal');
  });

  it('derives the water body type from nearby water features even when land features appear first', async () => {
    const stub = createFetchStub();
    const service = new RouteEnrichmentService(stub.fetch, localStorage);

    const enrichment = await service.enrichRoute(routeWithoutWaterTags);

    expect(enrichment.source).toBe('network');
    expect(enrichment.waterBodyType).toBe('canal');
  });
});
