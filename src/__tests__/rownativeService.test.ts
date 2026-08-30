import { afterEach, describe, expect, it, vi } from 'vitest';
import { RownativeCourseNotFoundError, RownativeService } from '../services/rownativeService';
import { RouteService } from '../services/routeService';
import { polylineLengthMeters } from '../utils/coordinateUtils';

/** Response double exposing both json() and text(), as the service uses each. */
function jsonResponse(body: unknown, status = 200) {
  const text = JSON.stringify(body);
  return { ok: status >= 200 && status < 300, status, json: async () => body, text: async () => text } as unknown as Response;
}

describe('RownativeService', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('calls the global fetch with the correct receiver when none is injected', async () => {
    // Regression: the constructor default used to store a bare `fetch` on an
    // instance field, so `this.fetchImpl(...)` invoked it with the service as
    // its receiver and browsers threw "Illegal invocation". Every unit test
    // injects a double, so only a real browser ever hit it.
    const globalFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({
      id: '1',
      name: 'Course One',
      country: 'United States',
      distance_m: 5306,
      polygons: [
        { order: 0, points: [{ lat: 42.24, lon: -71.81 }] },
        { order: 1, points: [{ lat: 42.28, lon: -71.81 }] },
      ],
    }));

    const service = new RownativeService();
    await expect(service.importCourseById('1')).resolves.toBeDefined();
    expect(globalFetch).toHaveBeenCalledTimes(1);
    // Invoked as a plain call, not as a method of the service instance.
    expect(globalFetch.mock.instances[0]).not.toBeInstanceOf(RownativeService);
  });

  it('searches courses by name from the index', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [
        { id: '1', name: 'Amsterdam Canal Sprint', country: 'Netherlands', distance_m: 2000 },
        { id: '2', name: 'Boston Head Course', country: 'United States', distance_m: 4800 },
      ],
    } as Response);

    const service = new RownativeService(fetchMock as unknown as typeof fetch);
    const results = await service.searchCourses('amsterdam');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('1');
    expect(results[0].distanceMeters).toBe(2000);
  });

  it('imports a course and creates a rownative WaterRoute', async () => {
    const isolatedRouteService = new RouteService();
    const initialCount = isolatedRouteService.getAllRoutes().length;
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [{ id: '77', name: 'River Course', country: 'Germany', distance_m: 6200 }],
      } as Response)
      .mockResolvedValueOnce(jsonResponse({
        id: '77',
        name: 'River Course',
        country: 'Germany',
        distance_m: 6200,
        status: 'provisional',
        polygons: [
          { order: 0, points: [{ lat: 52.5, lon: 13.4 }, { lat: 52.51, lon: 13.41 }, { lat: 52.5, lon: 13.42 }] },
          { order: 1, points: [{ lat: 52.52, lon: 13.43 }, { lat: 52.53, lon: 13.44 }, { lat: 52.52, lon: 13.45 }] },
        ],
      }));

    const service = new RownativeService(
      fetchMock as unknown as typeof fetch,
      (data) => isolatedRouteService.importRouteFromRownative(data),
    );
    const [course] = await service.searchCourses('river');
    const imported = await service.importCourse(course);

    expect(imported.source).toBe('rownative');
    // Distance is measured from the geometry, never taken from distance_m (#194 R-5).
    expect(imported.geometrySource).toBe('gate-chain');
    expect(imported.externalDistanceMeters).toBe(6200);
    expect(Math.abs(imported.distance * 1000 - polylineLengthMeters(imported.coordinates))).toBeLessThan(1);
    // The two polygon centroids are the route's endpoints, but the centreline is
    // densified in between so the engine gets demo-route resolution (issue #189).
    expect(imported.coordinates.length).toBeGreaterThan(2);
    // Endpoints are the polygon centroids: mean of each gate's three vertices.
    expect(imported.coordinates[0].lat).toBeCloseTo(52.50333, 4);
    expect(imported.coordinates[0].lng).toBeCloseTo(13.41, 4);
    const last = imported.coordinates[imported.coordinates.length - 1];
    expect(last.lat).toBeCloseTo(52.52333, 4);
    expect(last.lng).toBeCloseTo(13.44, 4);
    expect(isolatedRouteService.getAllRoutes().length).toBe(initialCount + 1);
  });

  it('imports a course by id alone, without an index lookup', async () => {
    const isolatedRouteService = new RouteService();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      id: '106',
      name: 'HOTS Stake Race',
      country: 'United States',
      distance_m: 4804,
      status: 'established',
      polygons: [
        { order: 0, points: [{ lat: 42.24, lon: -71.81 }] },
        { order: 1, points: [{ lat: 42.28, lon: -71.79 }] },
      ],
    }));

    const service = new RownativeService(
      fetchMock as unknown as typeof fetch,
      (data) => isolatedRouteService.importRouteFromRownative(data),
    );
    const route = await service.importCourseById('106');

    // One request only: the course JSON already carries name/country/distance.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toContain('/106.json');
    expect(route.name).toBe('HOTS Stake Race');
    expect(route.externalDistanceMeters).toBe(4804);
    expect(Math.abs(route.distance * 1000 - polylineLengthMeters(route.coordinates))).toBeLessThan(1);
    expect(route.source).toBe('rownative');
  });

  it('rejects malformed input before making any request', async () => {
    const fetchMock = vi.fn();
    const service = new RownativeService(fetchMock as unknown as typeof fetch);

    await expect(service.importCourseById('../../secrets')).rejects.toThrow(/course ID or a rownative\.icu course link/i);
    await expect(service.importCourseById('')).rejects.toThrow(/course ID or a rownative\.icu course link/i);
    await expect(service.importCourseById('https://evil.example/course/5')).rejects.toThrow(/https:\/\/ links on rownative\.icu/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports a course missing from the mirror as recoverable, carrying the id', async () => {
    // The live site lists more courses than the mirror carries, so a real id can 404.
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 404 } as Response);
    const service = new RownativeService(fetchMock as unknown as typeof fetch);

    await expect(service.importCourseById('2')).rejects.toBeInstanceOf(RownativeCourseNotFoundError);
    await expect(service.importCourseById('2')).rejects.toThrow(/isn't in the public course data yet/i);
    await service.importCourseById('2').catch((e: unknown) => {
      expect((e as RownativeCourseNotFoundError).courseId).toBe('2');
    });
  });

  it('reports a non-404 failure as a plain retryable error', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500 } as Response);
    const service = new RownativeService(fetchMock as unknown as typeof fetch);

    await expect(service.importCourseById('5')).rejects.toThrow(
      'Unable to load rownative course data (HTTP 500). Please try again.',
    );
    await expect(service.importCourseById('5')).rejects.not.toBeInstanceOf(RownativeCourseNotFoundError);
  });

  it('rejects malformed JSON and payloads missing required fields', async () => {
    const badJson = new RownativeService(
      vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => 'not json at all' } as unknown as Response) as unknown as typeof fetch,
    );
    await expect(badJson.importCourseById('5')).rejects.toThrow('Course 5 data is malformed.');

    const missingFields = new RownativeService(
      vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => JSON.stringify({ polygons: [] }) }) as unknown as typeof fetch,
    );
    await expect(missingFields.importCourseById('5')).rejects.toThrow('Course 5 data is malformed.');
  });

  it('rejects a course payload larger than the size cap', async () => {
    const huge = JSON.stringify({ id: '5', name: 'Huge', padding: 'x'.repeat(3 * 1024 * 1024) });
    const service = new RownativeService(
      vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => huge }) as unknown as typeof fetch,
    );
    await expect(service.importCourseById('5')).rejects.toThrow('Course 5 data is too large to import.');
  });

  it('rejects a course with no usable polygons', async () => {
    const service = new RownativeService(
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ id: '5', name: 'Empty Course', polygons: [] }),
      }) as unknown as typeof fetch,
    );
    await expect(service.importCourseById('5')).rejects.toThrow(/insufficient coordinate data/i);
  });

  it('resolves a pasted course link end to end', async () => {
    const isolatedRouteService = new RouteService();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        id: '5', name: 'Quinsig S to N', country: 'United States', distance_m: 5349, status: 'established',
        polygons: [
          { order: 0, points: [{ lat: 42.246, lon: -71.746 }] },
          { order: 1, points: [{ lat: 42.28, lon: -71.75 }] },
        ],
      }),
    });
    const service = new RownativeService(
      fetchMock as unknown as typeof fetch,
      (data) => isolatedRouteService.importRouteFromRownative(data),
    );

    const route = await service.importCourseById('https://rownative.icu/course/5');
    expect(route.name).toBe('Quinsig S to N');
    expect(route.externalId).toBe('5');
    expect(fetchMock.mock.calls[0][0]).toContain('/5.json');
    // AC-6: course data comes only from the GitHub mirror.
    expect(fetchMock.mock.calls[0][0]).toContain('raw.githubusercontent.com/rownative/courses');
    expect(String(fetchMock.mock.calls[0][0])).not.toContain('rownative.icu/api');
  });

  it('names the course when importCourseById geometry is insufficient', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ id: '9', name: 'Broken Course', polygons: [{ order: 0, points: [{ lat: 1, lon: 2 }] }] }),
    );
    const service = new RownativeService(fetchMock as unknown as typeof fetch);

    await expect(service.importCourseById('9')).rejects.toThrow('Broken Course (9) has insufficient coordinate data');
  });

  it('throws a helpful error when course geometry has insufficient points', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [{ id: '9', name: 'Broken Course', country: 'Unknown', distance_m: 1000 }],
      } as Response)
      .mockResolvedValueOnce(jsonResponse({
        id: '9',
        name: 'Broken Course',
        polygons: [{ order: 0, points: [{ lat: 1, lon: 2 }] }],
      }));

    const service = new RownativeService(fetchMock as unknown as typeof fetch);
    const [course] = await service.searchCourses('broken');

    await expect(service.importCourse(course)).rejects.toThrow('Broken Course (9) has insufficient coordinate data');
  });

  it('reuses the same in-flight index fetch for concurrent callers', async () => {
    let resolveJson!: (value: Array<{ id: string; name: string; country: string; distance_m: number }>) => void;
    const jsonPromise = new Promise<Array<{ id: string; name: string; country: string; distance_m: number }>>((resolve) => {
      resolveJson = resolve;
    });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => jsonPromise,
    } as Response);

    const service = new RownativeService(fetchMock as unknown as typeof fetch);
    const first = service.searchCourses('river');
    const second = service.searchCourses('river');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    resolveJson([{ id: '1', name: 'River Course', country: 'Germany', distance_m: 6200 }]);

    const [firstResults, secondResults] = await Promise.all([first, second]);
    expect(firstResults).toEqual(secondResults);
  });

  it('does not include raw URLs in HTTP errors', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
    } as Response);

    const service = new RownativeService(fetchMock as unknown as typeof fetch);

    await expect(service.searchCourses('river')).rejects.toThrow(
      'Unable to load rownative course data (HTTP 404). Please try again.',
    );
  });

});
