import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  RouteEnrichmentService,
  osmTagsToSceneryProfile,
  osmTagsToWaterBodyType,
  getDefaultBankWidth,
  calculateBoundingBox,
  type Coordinate,
  type OSMFeature,
  type RouteEnrichment,
} from '../services/routeEnrichmentService';

describe('RouteEnrichmentService', () => {
  describe('osmTagsToSceneryProfile', () => {
    it('returns dense-forest for forest landuse', () => {
      expect(osmTagsToSceneryProfile({ landuse: 'forest' })).toBe('dense-forest');
    });

    it('returns dense-forest for wood natural tag', () => {
      expect(osmTagsToSceneryProfile({ natural: 'wood' })).toBe('dense-forest');
    });

    it('returns residential for residential landuse', () => {
      expect(osmTagsToSceneryProfile({ landuse: 'residential' })).toBe('residential');
    });

    it('returns commercial for commercial landuse', () => {
      expect(osmTagsToSceneryProfile({ landuse: 'commercial' })).toBe('commercial');
    });

    it('returns commercial for industrial landuse', () => {
      expect(osmTagsToSceneryProfile({ landuse: 'industrial' })).toBe('commercial');
    });

    it('returns farmland for farmland landuse', () => {
      expect(osmTagsToSceneryProfile({ landuse: 'farmland' })).toBe('farmland');
    });

    it('returns farmland for grass landuse', () => {
      expect(osmTagsToSceneryProfile({ landuse: 'grass' })).toBe('farmland');
    });

    it('returns farmland for meadow landuse', () => {
      expect(osmTagsToSceneryProfile({ landuse: 'meadow' })).toBe('farmland');
    });

    it('returns beach for beach natural tag', () => {
      expect(osmTagsToSceneryProfile({ natural: 'beach' })).toBe('beach');
    });

    it('returns beach for sand natural tag', () => {
      expect(osmTagsToSceneryProfile({ natural: 'sand' })).toBe('beach');
    });

    it('returns wetland for wetland natural tag', () => {
      expect(osmTagsToSceneryProfile({ natural: 'wetland' })).toBe('wetland');
    });

    it('returns default for unknown tags', () => {
      expect(osmTagsToSceneryProfile({})).toBe('default');
      expect(osmTagsToSceneryProfile({ foo: 'bar' })).toBe('default');
    });
  });

  describe('osmTagsToWaterBodyType', () => {
    it('returns river for waterway=river', () => {
      expect(osmTagsToWaterBodyType({ waterway: 'river' })).toBe('river');
    });

    it('returns canal for waterway=canal', () => {
      expect(osmTagsToWaterBodyType({ waterway: 'canal' })).toBe('canal');
    });

    it('returns stream for waterway=stream', () => {
      expect(osmTagsToWaterBodyType({ waterway: 'stream' })).toBe('stream');
    });

    it('returns lake for natural=water with water=lake', () => {
      expect(osmTagsToWaterBodyType({ natural: 'water', water: 'lake' })).toBe('lake');
    });

    it('returns lake for natural=water with water=reservoir', () => {
      expect(osmTagsToWaterBodyType({ natural: 'water', water: 'reservoir' })).toBe('lake');
    });

    it('returns unknown for natural=water without water type', () => {
      expect(osmTagsToWaterBodyType({ natural: 'water' })).toBe('unknown');
    });

    it('returns unknown for unrecognized tags', () => {
      expect(osmTagsToWaterBodyType({})).toBe('unknown');
      expect(osmTagsToWaterBodyType({ foo: 'bar' })).toBe('unknown');
    });
  });

  describe('getDefaultBankWidth', () => {
    it('returns parsed OSM width when valid', () => {
      expect(getDefaultBankWidth('river', '45.5')).toBe(45.5);
      expect(getDefaultBankWidth('canal', '12')).toBe(12);
    });

    it('returns default for river when no OSM width', () => {
      expect(getDefaultBankWidth('river')).toBe(55);
    });

    it('returns default for canal when no OSM width', () => {
      expect(getDefaultBankWidth('canal')).toBe(15);
    });

    it('returns default for stream when no OSM width', () => {
      expect(getDefaultBankWidth('stream')).toBe(7.5);
    });

    it('returns default for lake when no OSM width', () => {
      expect(getDefaultBankWidth('lake')).toBe(100);
    });

    it('returns default for unknown when no OSM width', () => {
      expect(getDefaultBankWidth('unknown')).toBe(40);
    });

    it('ignores invalid OSM width and uses default', () => {
      expect(getDefaultBankWidth('river', 'invalid')).toBe(55);
      expect(getDefaultBankWidth('river', '-10')).toBe(55);
      expect(getDefaultBankWidth('river', '0')).toBe(55);
    });
  });

  describe('calculateBoundingBox', () => {
    it('calculates correct bounding box for single point', () => {
      const coords: Coordinate[] = [{ lat: 50.0, lng: 10.0 }];
      const bbox = calculateBoundingBox(coords, 200);

      expect(bbox.minLat).toBeLessThan(50.0);
      expect(bbox.maxLat).toBeGreaterThan(50.0);
      expect(bbox.minLng).toBeLessThan(10.0);
      expect(bbox.maxLng).toBeGreaterThan(10.0);
    });

    it('calculates correct bounding box for multiple points', () => {
      const coords: Coordinate[] = [
        { lat: 50.0, lng: 10.0 },
        { lat: 51.0, lng: 11.0 },
        { lat: 49.5, lng: 9.5 },
      ];
      const bbox = calculateBoundingBox(coords, 0);

      expect(bbox.minLat).toBe(49.5);
      expect(bbox.maxLat).toBe(51.0);
      expect(bbox.minLng).toBe(9.5);
      expect(bbox.maxLng).toBe(11.0);
    });

    it('applies margin correctly', () => {
      const coords: Coordinate[] = [{ lat: 50.0, lng: 10.0 }];
      const bboxNoMargin = calculateBoundingBox(coords, 0);
      const bboxWithMargin = calculateBoundingBox(coords, 200);

      expect(bboxWithMargin.minLat).toBeLessThan(bboxNoMargin.minLat);
      expect(bboxWithMargin.maxLat).toBeGreaterThan(bboxNoMargin.maxLat);
      expect(bboxWithMargin.minLng).toBeLessThan(bboxNoMargin.minLng);
      expect(bboxWithMargin.maxLng).toBeGreaterThan(bboxNoMargin.maxLng);
    });

    it('throws error for empty coordinates', () => {
      expect(() => calculateBoundingBox([])).toThrow('Cannot calculate bounding box for empty coordinates');
    });
  });

  describe('RouteEnrichmentService - caching', () => {
    let service: RouteEnrichmentService;
    let mockFetch: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      localStorage.clear();
      mockFetch = vi.fn();
      service = new RouteEnrichmentService(mockFetch);
    });

    it('caches enrichment data after first fetch', async () => {
      const coords: Coordinate[] = [
        { lat: 50.0, lng: 10.0 },
        { lat: 50.01, lng: 10.01 },
      ];

      // Mock API responses
      mockFetch.mockImplementation((url: string) => {
        if (typeof url === 'string' && url.includes('opentopodata')) {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                results: [{ elevation: 100 }, { elevation: 105 }],
              }),
          });
        }
        // OSM Overpass
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              elements: [],
            }),
        });
      });

      // First call - should hit APIs
      const result1 = await service.enrichRoute('test-route', coords);
      expect(mockFetch).toHaveBeenCalled();
      expect(result1.points).toHaveLength(2);

      // Reset mock
      mockFetch.mockClear();

      // Second call - should use cache
      const result2 = await service.enrichRoute('test-route', coords);
      expect(mockFetch).not.toHaveBeenCalled();
      expect(result2.points).toHaveLength(2);
      expect(result2.routeId).toBe('test-route');
    });

    it('clears cache for specific route', async () => {
      const coords: Coordinate[] = [{ lat: 50.0, lng: 10.0 }];

      mockFetch.mockImplementation((url: string) => {
        if (typeof url === 'string' && url.includes('opentopodata')) {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                results: [{ elevation: 100 }],
              }),
          });
        }
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              elements: [],
            }),
        });
      });

      // First call
      await service.enrichRoute('test-route', coords);
      mockFetch.mockClear();

      // Clear cache
      service.clearCache('test-route');

      // Should hit APIs again
      await service.enrichRoute('test-route', coords);
      expect(mockFetch).toHaveBeenCalled();
    });

    it('clears all cached enrichment data', async () => {
      const coords: Coordinate[] = [{ lat: 50.0, lng: 10.0 }];

      mockFetch.mockImplementation((url: string) => {
        if (typeof url === 'string' && url.includes('opentopodata')) {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                results: [{ elevation: 100 }],
              }),
          });
        }
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              elements: [],
            }),
        });
      });

      // Cache multiple routes
      await service.enrichRoute('route-1', coords);
      await service.enrichRoute('route-2', coords);
      mockFetch.mockClear();

      // Clear all
      service.clearAllCache();

      // Should hit APIs for both
      await service.enrichRoute('route-1', coords);
      await service.enrichRoute('route-2', coords);
      expect(mockFetch.mock.calls.length).toBeGreaterThan(0);
    });
  });

  describe('RouteEnrichmentService - elevation fetching', () => {
    let service: RouteEnrichmentService;
    let mockFetch: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      mockFetch = vi.fn();
      service = new RouteEnrichmentService(mockFetch);
    });

    it('fetches elevation data for coordinates', async () => {
      const coords: Coordinate[] = [
        { lat: 50.0, lng: 10.0 },
        { lat: 50.01, lng: 10.01 },
      ];

      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            results: [{ elevation: 100 }, { elevation: 105 }],
          }),
      });

      const elevations = await service.fetchElevationData(coords);

      expect(elevations).toEqual([100, 105]);
      expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('opentopodata'));
    });

    it('batches elevation requests at 100 points', async () => {
      // Create 250 coordinates (should result in 3 batches: 100, 100, 50)
      const coords: Coordinate[] = Array.from({ length: 250 }, (_, i) => ({
        lat: 50.0 + i * 0.001,
        lng: 10.0 + i * 0.001,
      }));

      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            results: Array(100).fill({ elevation: 100 }),
          }),
      });

      await service.fetchElevationData(coords);

      // Should make 3 API calls (250 / 100 = 3 batches)
      expect(mockFetch.mock.calls.length).toBeGreaterThanOrEqual(3);
    });

    it('handles elevation API errors gracefully', async () => {
      const coords: Coordinate[] = [{ lat: 50.0, lng: 10.0 }];

      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
      });

      const elevations = await service.fetchElevationData(coords);

      expect(elevations).toEqual([undefined]);
    });

    it('handles null elevation values', async () => {
      const coords: Coordinate[] = [{ lat: 50.0, lng: 10.0 }];

      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            results: [{ elevation: null }],
          }),
      });

      const elevations = await service.fetchElevationData(coords);

      expect(elevations).toEqual([undefined]);
    });
  });

  describe('RouteEnrichmentService - OSM fetching', () => {
    let service: RouteEnrichmentService;
    let mockFetch: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      mockFetch = vi.fn();
      service = new RouteEnrichmentService(mockFetch);
    });

    it('fetches OSM features for route bounding box', async () => {
      const coords: Coordinate[] = [
        { lat: 50.0, lng: 10.0 },
        { lat: 50.01, lng: 10.01 },
      ];

      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            elements: [
              {
                type: 'way',
                id: 123,
                tags: { landuse: 'forest' },
                geometry: [
                  { lat: 50.0, lon: 10.0 },
                  { lat: 50.005, lon: 10.005 },
                ],
              },
            ],
          }),
      });

      const features = await service.fetchOSMFeatures(coords);

      expect(features).toHaveLength(1);
      expect(features[0].tags.landuse).toBe('forest');
      expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('overpass'), expect.any(Object));
    });

    it('handles OSM API errors gracefully', async () => {
      const coords: Coordinate[] = [{ lat: 50.0, lng: 10.0 }];

      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
      });

      const features = await service.fetchOSMFeatures(coords);

      expect(features).toEqual([]);
    });

    it('handles missing tags in OSM features', async () => {
      const coords: Coordinate[] = [{ lat: 50.0, lng: 10.0 }];

      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            elements: [
              {
                type: 'way',
                id: 123,
                // No tags
              },
            ],
          }),
      });

      const features = await service.fetchOSMFeatures(coords);

      expect(features[0].tags).toEqual({});
    });
  });

  describe('RouteEnrichmentService - integration', () => {
    let service: RouteEnrichmentService;
    let mockFetch: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      localStorage.clear();
      mockFetch = vi.fn();
      service = new RouteEnrichmentService(mockFetch);
    });

    it('enriches route with full data pipeline', async () => {
      const coords: Coordinate[] = [
        { lat: 50.0, lng: 10.0 },
        { lat: 50.01, lng: 10.01 },
      ];

      mockFetch.mockImplementation((url: string | Request) => {
        const urlString = typeof url === 'string' ? url : url.url;
        if (urlString.includes('opentopodata')) {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                results: [{ elevation: 100 }, { elevation: 105 }],
              }),
          });
        }
        // OSM Overpass
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              elements: [
                {
                  type: 'way',
                  id: 123,
                  tags: { waterway: 'river', width: '50' },
                  geometry: [
                    { lat: 50.0, lon: 10.0 },
                    { lat: 50.005, lon: 10.005 },
                  ],
                },
                {
                  type: 'way',
                  id: 124,
                  tags: { landuse: 'forest' },
                  geometry: [
                    { lat: 50.0, lon: 10.0 },
                    { lat: 50.005, lon: 10.005 },
                  ],
                },
              ],
            }),
        });
      });

      const enrichment = await service.enrichRoute('test-route', coords);

      expect(enrichment.routeId).toBe('test-route');
      expect(enrichment.points).toHaveLength(2);
      expect(enrichment.waterBodyType).toBe('river');
      expect(enrichment.defaultBankWidth).toBe(50); // From OSM width tag
      expect(enrichment.osmFeatures).toHaveLength(2);
      expect(enrichment.cachedAt).toBeGreaterThan(0);

      // Check individual points
      expect(enrichment.points[0].elevation).toBe(100);
      expect(enrichment.points[1].elevation).toBe(105);
    });

    it('falls back gracefully when all APIs fail', async () => {
      const coords: Coordinate[] = [{ lat: 50.0, lng: 10.0 }];

      mockFetch.mockRejectedValue(new Error('Network error'));

      const enrichment = await service.enrichRoute('test-route', coords);

      expect(enrichment.routeId).toBe('test-route');
      expect(enrichment.points).toHaveLength(1);
      expect(enrichment.points[0].elevation).toBeUndefined();
      expect(enrichment.points[0].sceneryProfile).toBe('default');
      expect(enrichment.waterBodyType).toBe('unknown');
      expect(enrichment.osmFeatures).toEqual([]);
    });
  });
});
