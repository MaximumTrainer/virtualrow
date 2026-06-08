import { afterEach, describe, expect, it, vi } from 'vitest';
import { RownativeService } from '../services/rownativeService';
import { RouteService } from '../services/routeService';

describe('RownativeService', () => {
  afterEach(() => {
    vi.restoreAllMocks();
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
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: '77',
          name: 'River Course',
          country: 'Germany',
          distance_m: 6200,
          status: 'provisional',
          polygons: [
            { order: 0, points: [{ lat: 52.5, lon: 13.4 }, { lat: 52.51, lon: 13.41 }, { lat: 52.5, lon: 13.42 }] },
            { order: 1, points: [{ lat: 52.52, lon: 13.43 }, { lat: 52.53, lon: 13.44 }, { lat: 52.52, lon: 13.45 }] },
          ],
        }),
      } as Response);

    const service = new RownativeService(
      fetchMock as unknown as typeof fetch,
      (data) => isolatedRouteService.importRouteFromRownative(data),
    );
    const [course] = await service.searchCourses('river');
    const imported = await service.importCourse(course);

    expect(imported.source).toBe('rownative');
    expect(imported.distance).toBe(6.2);
    expect(imported.coordinates).toHaveLength(2);
    expect(isolatedRouteService.getAllRoutes().length).toBe(initialCount + 1);
  });

  it('throws a helpful error when course geometry has insufficient points', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [{ id: '9', name: 'Broken Course', country: 'Unknown', distance_m: 1000 }],
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: '9',
          name: 'Broken Course',
          polygons: [{ order: 0, points: [{ lat: 1, lon: 2 }] }],
        }),
      } as Response);

    const service = new RownativeService(fetchMock as unknown as typeof fetch);
    const [course] = await service.searchCourses('broken');

    await expect(service.importCourse(course)).rejects.toThrow('Broken Course (9) has insufficient coordinate data');
  });
});
