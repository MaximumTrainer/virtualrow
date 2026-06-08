import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WaterRoute } from '../types/index';
import {
  ROUTE_ENRICHMENT_CACHE_TTL_MS,
  RouteEnrichmentService,
  buildOverpassQuery,
  calculateBearingDeltaForSegments,
  createFallbackRouteEnrichment,
  getRouteEnrichmentCacheKey,
  loadCachedRouteEnrichment,
  mapOsmTagsToSceneryProfile,
  saveCachedRouteEnrichment,
  splitCoordinatesIntoElevationBatches,
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

  it('builds an Overpass query with the expected tag filters', () => {
    const query = buildOverpassQuery(routeFixture.coordinates);

    expect(query).toContain('way["landuse"]');
    expect(query).toContain('way["waterway"]');
    expect(query).toContain('relation["building"]');
    expect(query).toContain('node["natural"]');
  });
});

describe('RouteEnrichmentService', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('fetches enrichment data, caches it, and reuses the cache on subsequent loads', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          results: routeFixture.coordinates.map((_, index) => ({
            elevation: 5 + index,
          })),
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          elements: [
            {
              type: 'way',
              tags: { landuse: 'forest' },
              bounds: {
                minlat: 51.499,
                minlon: -0.112,
                maxlat: 51.503,
                maxlon: -0.107,
              },
            },
            {
              type: 'way',
              tags: { waterway: 'canal', width: '14' },
              bounds: {
                minlat: 51.499,
                minlon: -0.112,
                maxlat: 51.503,
                maxlon: -0.107,
              },
            },
          ],
        }),
      } as Response);

    const service = new RouteEnrichmentService(
      fetchMock as unknown as typeof fetch,
      localStorage,
    );

    const first = await service.enrichRoute(routeFixture);
    const second = await service.enrichRoute(routeFixture);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(first.source).toBe('network');
    expect(first.elevations).toHaveLength(routeFixture.coordinates.length);
    expect(first.waterBodyType).toBe('canal');
    expect(first.segmentProfiles[0].sceneryProfile).toBe('forest');
    expect(first.segmentProfiles[0].waterWidthMeters).toBe(14);
    expect(first.segmentProfiles.length).toBeGreaterThan(0);
    expect(second.source).toBe('cache');
  });

  it('falls back quietly when the APIs fail', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('network down'));
    const service = new RouteEnrichmentService(
      fetchMock as unknown as typeof fetch,
      localStorage,
    );

    const enrichment = await service.enrichRoute(routeFixture);

    expect(enrichment.source).toBe('fallback');
    expect(enrichment.elevations).toHaveLength(routeFixture.coordinates.length);
    expect(enrichment.segmentProfiles.length).toBeGreaterThan(0);
  });

  it('returns fallback immediately for routes without coordinates', async () => {
    const fetchMock = vi.fn();
    const service = new RouteEnrichmentService(
      fetchMock as unknown as typeof fetch,
      localStorage,
    );

    const enrichment = await service.enrichRoute({
      ...routeFixture,
      id: 'route-empty',
      coordinates: [],
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(enrichment.source).toBe('fallback');
    expect(enrichment.elevations).toEqual([]);
  });

  it('returns network enrichment when cache writes fail', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          results: routeFixture.coordinates.map((_, index) => ({
            elevation: 5 + index,
          })),
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          elements: [
            {
              type: 'way',
              tags: { landuse: 'forest' },
              bounds: {
                minlat: 51.499,
                minlon: -0.112,
                maxlat: 51.503,
                maxlon: -0.107,
              },
            },
            {
              type: 'way',
              tags: { waterway: 'canal', width: '14' },
              bounds: {
                minlat: 51.499,
                minlon: -0.112,
                maxlat: 51.503,
                maxlon: -0.107,
              },
            },
          ],
        }),
      } as Response);
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded');
    });
    const service = new RouteEnrichmentService(
      fetchMock as unknown as typeof fetch,
      localStorage,
    );

    const enrichment = await service.enrichRoute(routeFixture);

    expect(setItem).toHaveBeenCalled();
    expect(enrichment.source).toBe('network');
    expect(enrichment.waterBodyType).toBe('canal');
  });

  it('derives the water body type from nearby water features even when land features appear first', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          results: routeWithoutWaterTags.coordinates.map((_, index) => ({
            elevation: 5 + index,
          })),
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          elements: [
            {
              type: 'way',
              tags: { landuse: 'forest' },
              bounds: {
                minlat: 51.499,
                minlon: -0.112,
                maxlat: 51.503,
                maxlon: -0.107,
              },
            },
            {
              type: 'way',
              tags: { waterway: 'canal', width: '14' },
              bounds: {
                minlat: 51.499,
                minlon: -0.112,
                maxlat: 51.503,
                maxlon: -0.107,
              },
            },
          ],
        }),
      } as Response);
    const service = new RouteEnrichmentService(
      fetchMock as unknown as typeof fetch,
      localStorage,
    );

    const enrichment = await service.enrichRoute(routeWithoutWaterTags);

    expect(enrichment.source).toBe('network');
    expect(enrichment.waterBodyType).toBe('canal');
  });
});
