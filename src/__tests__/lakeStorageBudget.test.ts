import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { LakePolygon } from '../utils/lakePolygons';
import type { Coordinate, WaterRoute } from '../types/index';
import {
  getRouteEnrichmentCacheKey,
  ROUTE_ENRICHMENT_CACHE_TTL_MS,
  ROUTE_ENRICHMENT_STORAGE_BUDGET,
  saveCachedRouteEnrichment,
  type RouteEnrichmentData,
  OVERPASS_API_URL,
  RouteEnrichmentService,
  type OverpassElement,
} from '../services/routeEnrichmentService';
import { runDetectionInline } from '../services/routeDetectionRunner';

/** #493 NFR3 / AC10: a route's cache entry stays within 128 KB. */
interface OsmFixture {
  courseId: number;
  name: string;
  route: Coordinate[];
  elements: OverpassElement[];
}

const DIR = join(process.cwd(), 'src/__tests__/fixtures/osm');
const fixtures: OsmFixture[] = readdirSync(DIR)
  .filter((file) => file.endsWith('.json'))
  .map((file) => JSON.parse(readFileSync(join(DIR, file), 'utf8')) as OsmFixture);

const memoryStorage = (): Storage => {
  const items = new Map<string, string>();
  return {
    get length() {
      return items.size;
    },
    key: (index) => [...items.keys()][index] ?? null,
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => void items.set(key, value),
    removeItem: (key) => void items.delete(key),
    clear: () => items.clear(),
  };
};

const fixtureFetch = (fixture: OsmFixture, calls: string[] = []) =>
  (async (input: RequestInfo | URL) => {
    calls.push(String(input));
    const body = String(input).startsWith(OVERPASS_API_URL)
      ? { elements: fixture.elements }
      : { results: fixture.route.map(() => ({ elevation: 4 })) };
    return new Response(JSON.stringify(body), { status: 200 });
  }) as typeof fetch;

const byId = (id: number) => fixtures.find((fixture) => fixture.courseId === id)!;

const enrichFixture = async (fixture: OsmFixture, storage = memoryStorage(), calls: string[] = []) => {
  const service = new RouteEnrichmentService(fixtureFetch(fixture, calls), storage, runDetectionInline);
  const route = { id: `course-${fixture.courseId}`, name: fixture.name, coordinates: fixture.route, tags: [] } as unknown as WaterRoute;
  const enrichment = await service.enrichRoute(route);
  return { enrichment, service, route, stored: storage.getItem(getRouteEnrichmentCacheKey(route.id)) ?? '' };
};

describe('#493 lake outline storage budget (NFR3, AC10)', () => {
  it.each(fixtures.map((fixture) => [fixture.courseId, fixture] as const))(
    'course %i stores at most 128 KB',
    async (_id, fixture) => {
      const { stored } = await enrichFixture(fixture);
      expect(stored.length).toBeGreaterThan(0);
      expect(stored.length).toBeLessThanOrEqual(128 * 1024);
    },
    20_000,
  );

  it('stores each lake outline whole when the route is within budget', async () => {
    const { enrichment, stored } = await enrichFixture(byId(1));
    expect(enrichment.lakes?.polygons.length).toBeGreaterThan(0);
    expect(JSON.parse(stored).data.lakes.polygons).toEqual(enrichment.lakes?.polygons);
  });

  it('reads back what it stored: same lakes, same segment densities, shores to a tenth of a metre', async () => {
    const { enrichment, service } = await enrichFixture(byId(1));
    const cached = service.readCached(`course-1`).data!;
    expect(cached.lakes).toEqual(enrichment.lakes);
    expect(cached.segmentProfiles).toHaveLength(enrichment.segmentProfiles.length);
    cached.segmentProfiles.forEach((segment, index) => {
      const original = enrichment.segmentProfiles[index];
      expect(segment.treeDensity).toBe(original.treeDensity);
      expect(segment.vegetationDensity).toBe(original.vegetationDensity);
      expect(segment.buildingDensity).toBe(original.buildingDensity);
      expect(segment.objectScale).toBe(original.objectScale);
      expect(segment.dragMultiplier).toBe(original.dragMultiplier);
      expect(segment.onLake).toBe(original.onLake);
      expect(segment.waterWidthMeters).toBeCloseTo(original.waterWidthMeters, 1);
      expect(segment.bearing).toBeCloseTo(original.bearing, 2);
      if (typeof original.leftShoreMeters === 'number') expect(segment.leftShoreMeters).toBeCloseTo(original.leftShoreMeters, 1);
      else expect(segment.leftShoreMeters).toBe(original.leftShoreMeters);
    });
  });

  it('draws a cached lake with no Overpass call (AC9)', async () => {
    const storage = memoryStorage();
    await enrichFixture(byId(1), storage);
    const calls: string[] = [];
    const { enrichment } = await enrichFixture(byId(1), storage, calls);
    expect(calls).toEqual([]);
    expect(enrichment.source).toBe('cache');
    expect(enrichment.lakes?.polygons.length).toBeGreaterThan(0);
  });

  it('keeps a stale lake readable while it re-fetches, and falls back to it if the re-fetch fails (AC9)', async () => {
    const storage = memoryStorage();
    const { enrichment } = await enrichFixture(byId(1), storage);
    vi.spyOn(Date, 'now').mockReturnValue(enrichment.fetchedAt + ROUTE_ENRICHMENT_CACHE_TTL_MS + 1);
    try {
      const failing = new RouteEnrichmentService((async () => { throw new Error('offline'); }) as typeof fetch, storage, runDetectionInline);
      const stale = failing.readCached('course-1');
      expect(stale.stale).toBe(true);
      expect(stale.data?.lakes).toEqual(enrichment.lakes);
      const route = { id: 'course-1', name: 'x', coordinates: byId(1).route, tags: [] } as unknown as WaterRoute;
      expect((await failing.enrichRoute(route)).lakes).toEqual(enrichment.lakes);
    } finally {
      vi.restoreAllMocks();
    }
  });

  describe('a route over budget (NFR3)', () => {
    const square = (lat: number, lng: number, vertices: number): Coordinate[] => {
      const ring = Array.from({ length: vertices }, (_, index) => {
        const angle = (index / vertices) * 2 * Math.PI;
        return { lat: lat + 0.01 * Math.sin(angle) * (1 + 0.1 * Math.sin(7 * angle)), lng: lng + 0.01 * Math.cos(angle) };
      });
      return [...ring, ring[0]];
    };
    const lake = (id: number, lat: number, vertices: number): LakePolygon => ({ featureId: `way/${id}`, outer: square(lat, 0, vertices), inner: [] });
    const route: Coordinate[] = [{ lat: 0, lng: 0 }, { lat: 0.001, lng: 0 }];
    // The near lake is listed last, so keeping it is the budget's choice, not the order.
    const lakes = [lake(3, 0.3, 2047), lake(2, 0.2, 2047), lake(1, 0, 2047)];
    const data = (polygons: LakePolygon[]): RouteEnrichmentData => ({
      routeId: 'big',
      elevations: [],
      segmentProfiles: [],
      crossings: [],
      waterBodyType: 'lake',
      waterWidthMeters: 100,
      waterColor: '#000',
      waveIntensity: 0,
      lakes: { polygons, elevationMeters: 0 },
      fetchedAt: 0,
      source: 'network',
    } as unknown as RouteEnrichmentData);

    it('keeps the lakes nearest the route and drops the far ones', () => {
      const storage = memoryStorage();
      saveCachedRouteEnrichment('big', data(lakes), storage, route);
      const stored = storage.getItem(getRouteEnrichmentCacheKey('big'))!;
      expect(stored.length).toBeLessThanOrEqual(ROUTE_ENRICHMENT_STORAGE_BUDGET);
      const kept = (JSON.parse(stored).data.lakes.polygons as LakePolygon[]).map((polygon) => polygon.featureId);
      expect(kept[0]).toBe('way/1');
      expect(kept).not.toContain('way/3');
    });

    it('slims the last lake when one alone is over budget, and keeps it', () => {
      const storage = memoryStorage();
      const huge: LakePolygon = { featureId: 'way/9', outer: square(0, 0, 2047), inner: Array.from({ length: 3 }, (_, index) => square(0.002 * index, 0, 1000)) };
      saveCachedRouteEnrichment('big', data([huge]), storage, route);
      const stored = storage.getItem(getRouteEnrichmentCacheKey('big'))!;
      expect(stored.length).toBeLessThanOrEqual(ROUTE_ENRICHMENT_STORAGE_BUDGET);
      expect(JSON.parse(stored).data.lakes.polygons.map((polygon: LakePolygon) => polygon.featureId)).toEqual(['way/9']);
    });
  });
});
